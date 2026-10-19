import React, { useState, useCallback, useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import {
  View, StyleSheet, ScrollView, Pressable, TextInput,
  RefreshControl, Modal, Platform, ActivityIndicator,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { ModuleErrorBoundary } from "@/components/ModuleErrorBoundary";
import RouteMiniMap from "@/components/RouteMiniMap";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { BusinessClockService } from "@/services/business-clock.service";
import { TransitWarningService } from "@/services/transit-warning.service";
import { addBusinessDays } from "@/utils/businessDate";
import { getDrivingMinutes } from "@/utils/googleMaps";
import { formatDate } from "@/utils/format";
import { fetchAllPages } from "@/utils/supabasePagination";
import { collapseCurrentLocationSubmissions } from "@/services/field-visit.service";
const GMAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const GMAPS_MAP_ID = process.env.EXPO_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

// ─── Grace period config ─────────────────────────────────────────────────────
const GRACE_MINUTES = 30;

// ─── Types ───────────────────────────────────────────────────────────────────
interface TransitEntry {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  location_name: string;
  location_address: string | null;
  origin_coords: { latitude: number; longitude: number } | null;
  destination_coords: { latitude: number; longitude: number } | null;
  visit_type: string;
  created_at: string;
  status: "PENDING" | "CHECKED_IN" | "COMPLETED" | "MISSED" | "IN_TRANSIT";
  checkin_time: string | null;
  travel_minutes: number;
  overdue_minutes: number;
  expected_by: string;
  is_dismissed: boolean;
  dismiss_note: string | null;
  dismissed_by_name: string | null;
  warning_id: string | null;
  // ETA from Google Directions (minutes) — used for animated route card
  google_eta_minutes?: number | null;
  // When overdue+grace expires: if person hasn't checked in at destination by this ms, float to top of distance mismatch
  overdue_grace_deadline_ms?: number | null;
  // Transit from checked-in location
  is_transit_from_checkin?: boolean;
  last_checkin_location?: { latitude: number; longitude: number } | null;
  last_checkin_name?: string | null;
  distance_from_checkin?: number;
  eta_minutes?: number;
}

interface SuspiciousEntry {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  office_name: string;
  distance_m: number;
  checkin_time: string | null;
  reason: string;
  is_dismissed: boolean;
  dismiss_note: string | null;
  dismissed_by_name: string | null;
  warning_id: string | null;
}

function toUTC(iso: string | null): Date | null {
  if (!iso) return null;
  return new Date(iso.includes("Z") || iso.includes("+") ? iso : iso + "Z");
}
function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return toUTC(iso)!.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}
/** Minutes before the expected arrival at which a visit counts as "at risk". */
const AT_RISK_MINUTES = 15;
function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return toUTC(iso)!.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Dismiss Modal ───────────────────────────────────────────────────────────
function DismissModal({
  visible, name, onConfirm, onCancel,
}: {
  visible: boolean; name: string;
  onConfirm: (note: string) => void; onCancel: () => void;
}) {
  const { theme } = useTheme();
  const [note, setNote] = useState("");
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalBox, { backgroundColor: theme.backgroundDefault }]}>
          <ThemedText type="h3" style={{ marginBottom: 8 }}>Dismiss Warning</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 16 }}>
            {name} — HR will call this employee to confirm a genuine reason.
          </ThemedText>
          <TextInput
            style={[styles.noteInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
            placeholder="Add a note (reason for dismissal)..."
            placeholderTextColor={theme.textSecondary}
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
          />
          <View style={styles.modalBtns}>
            <Pressable style={[styles.modalBtn, { backgroundColor: theme.backgroundSecondary }]} onPress={onCancel}>
              <ThemedText type="caption" style={{ fontWeight: "600" }}>Cancel</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.modalBtn, { backgroundColor: "#10B981" }]}
              onPress={() => { onConfirm(note.trim()); setNote(""); }}
            >
              <Feather name="check" size={14} color="#fff" />
              <ThemedText type="caption" style={{ color: "#fff", fontWeight: "700", marginLeft: 4 }}>Dismiss</ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Animated moving-car route card ───────────────────────────────────────────
// Shows a Google Maps iframe with DirectionsRenderer (office → destination),
// a car emoji that travels the route, an ETA countdown, and a grace-period
// alert ("Not arrived yet — X min overdue") once the ETA+30min window closes.
function AnimatedRouteMap({
  originLat, originLon, destLat, destLon, etaMinutes, name,
}: {
  originLat: number; originLon: number; destLat: number; destLon: number;
  etaMinutes: number; name: string;
}) {
  if (Platform.OS !== "web") {
    return (
      <RouteMiniMap
        origin={{ latitude: originLat, longitude: originLon }}
        destination={{ latitude: destLat, longitude: destLon }}
        etaMinutes={etaMinutes}
        originLabel={`${name}: last known position`}
      />
    );
  }
  const safeName = name.replace(/['"<>&]/g, "");
  const etaSec = Math.max(etaMinutes * 60, 30);

  const html = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<script src="https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&libraries=marker"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body,#map{width:100%;height:100%;overflow:hidden;font-family:sans-serif}
#eta{position:absolute;top:8px;right:8px;background:rgba(30,41,59,0.92);
  color:#fff;padding:5px 10px;border-radius:8px;font-size:12px;font-weight:700;z-index:10;pointer-events:none}
#car{position:absolute;pointer-events:none;font-size:20px;z-index:20;
  transition:none;transform:translate(-50%,-50%)}
</style></head><body>
<div id="map"></div>
<div id="eta">ETA: ${etaMinutes} min</div>
<div id="car">🚗</div>
<script>
var map=new google.maps.Map(document.getElementById("map"),{
  zoom:13,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,
  zoomControl:true,center:{lat:${originLat},lng:${originLon}},mapId:"${GMAPS_MAP_ID}"
});
var origin={lat:${originLat},lng:${originLon}};
var dest={lat:${destLat},lng:${destLon}};
new google.maps.marker.AdvancedMarkerElement({map:map,position:origin,title:"Starting point"});
new google.maps.marker.AdvancedMarkerElement({map:map,position:dest,title:"Destination"});
var totalSec=${etaSec};
var elapsed=0;
var pathLatLngs=[];
var animTimer=null;
var countdownTimer=null;
var remaining=${etaMinutes};

// Countdown timer
countdownTimer=setInterval(function(){
  remaining=Math.max(0,remaining-1);
  document.getElementById("eta").textContent=remaining>0?"ETA: "+remaining+" min":"🏁 Arriving now";
},60000);

new google.maps.DirectionsService().route({
  origin:origin,destination:dest,travelMode:"DRIVING"
},function(res,status){
  if(status!=="OK"){
    // fallback: straight line
    pathLatLngs=[new google.maps.LatLng(origin.lat,origin.lng),
                 new google.maps.LatLng(dest.lat,dest.lng)];
    new google.maps.Polyline({map:map,path:pathLatLngs,
      strokeColor:"#2563EB",strokeWeight:4,strokeOpacity:0.85});
    startAnimate();
    return;
  }
  var renderer=new google.maps.DirectionsRenderer({
    map:map,directions:res,suppressMarkers:true,
    polylineOptions:{strokeColor:"#2563EB",strokeWeight:5,strokeOpacity:0.85}
  });
  var route=res.routes[0].legs[0];
  route.steps.forEach(function(step){
    step.path.forEach(function(ll){pathLatLngs.push(ll);});
  });
  map.fitBounds(new google.maps.LatLngBounds(
    new google.maps.LatLng(Math.min(origin.lat,dest.lat)-0.002,Math.min(origin.lng,dest.lng)-0.002),
    new google.maps.LatLng(Math.max(origin.lat,dest.lat)+0.002,Math.max(origin.lng,dest.lng)+0.002)
  ));
  // Duration label mid-route
  var steps=route.steps;
  var mid=steps[Math.floor(steps.length/2)].end_location;
  new google.maps.InfoWindow({
    content:'<div style="font-size:11px;font-weight:700;color:#1E293B">${safeName} · '+route.duration.text+'</div>',
    position:mid
  }).open(map);
  startAnimate();
});

function latLngToPixel(ll){
  var scale=Math.pow(2,map.getZoom());
  var proj=map.getProjection();
  if(!proj)return{x:0,y:0};
  var bounds=map.getBounds();if(!bounds)return{x:0,y:0};
  var nw=proj.fromLatLngToPoint(new google.maps.LatLng(bounds.getNorthEast().lat(),bounds.getSouthWest().lng()));
  var pt=proj.fromLatLngToPoint(ll);
  var mapEl=document.getElementById("map");
  return{x:Math.floor((pt.x-nw.x)*scale),y:Math.floor((pt.y-nw.y)*scale)};
}

function startAnimate(){
  if(pathLatLngs.length<2)return;
  var step=0;
  var stepsTotal=pathLatLngs.length-1;
  // Spread animation over totalSec, updating every 2s
  var intervalSec=2;
  var stepsPerTick=Math.max(1,Math.round(stepsTotal/(totalSec/intervalSec)));
  var car=document.getElementById("car");
  function moveCar(){
    if(step>=stepsTotal){car.style.display="none";clearInterval(animTimer);return;}
    var ll=pathLatLngs[step];
    var px=latLngToPixel(ll);
    car.style.left=px.x+"px";
    car.style.top=px.y+"px";
    // heading
    if(step<stepsTotal-1){
      var next=pathLatLngs[step+1];
      var npx=latLngToPixel(next);
      var angle=Math.atan2(npx.y-px.y,npx.x-px.x)*(180/Math.PI);
      car.style.transform="translate(-50%,-50%) rotate("+(angle)+"deg)";
    }
    step=Math.min(step+stepsPerTick,stepsTotal);
  }
  moveCar();
  animTimer=setInterval(moveCar,intervalSec*1000);
  // Re-anchor car after zoom/pan
  google.maps.event.addListener(map,"idle",moveCar);
}
</script></body></html>`;
  // srcDoc (not a data: URL) so the document inherits this page's origin and
  // the referrer-restricted Maps key sees https://bop.in as the referrer.
  // @ts-ignore
  return <iframe srcDoc={html}
    style={{ width: "100%", height: 280, border: "none", borderRadius: 10, display: "block", marginTop: 8 }}
    title={`Route for ${safeName}`} />;
}

// ─── Transit Card ─────────────────────────────────────────────────────────────
function TransitCard({ entry, onDismiss }: { entry: TransitEntry; onDismiss: (e: TransitEntry) => void }) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const eta = entry.google_eta_minutes ?? entry.eta_minutes ?? entry.travel_minutes;
  const isOverdueGrace = (entry.overdue_grace_deadline_ms ?? 0) > 0 && Date.now() > (entry.overdue_grace_deadline_ms ?? 0);
  const notDueYet = !entry.is_transit_from_checkin && entry.overdue_minutes < 0;
  const atRisk = notDueYet && -entry.overdue_minutes <= AT_RISK_MINUTES;
  const urgency = isOverdueGrace ? "#EF4444"
    : entry.is_transit_from_checkin ? "#3B82F6"
    : atRisk ? "#F59E0B"
    : notDueYet ? "#10B981"
    : entry.overdue_minutes > 60 ? "#EF4444"
    : entry.overdue_minutes > 30 ? "#F59E0B" : "#3B82F6";

  const hasRoute = entry.origin_coords && entry.destination_coords;

  return (
    <Pressable
      style={[styles.card, { backgroundColor: theme.backgroundDefault, borderLeftColor: entry.is_dismissed ? "#9CA3AF" : urgency }]}
      onPress={() => setExpanded(e => !e)}
    >
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          {entry.is_dismissed && (
            <View style={[styles.pill, { backgroundColor: "#D1FAE5", marginBottom: 4 }]}>
              <Feather name="check-circle" size={10} color="#10B981" />
              <ThemedText type="caption" style={{ color: "#10B981", fontWeight: "700", fontSize: 10, marginLeft: 3 }}>Dismissed</ThemedText>
            </View>
          )}
          {isOverdueGrace && !entry.is_dismissed && (
            <View style={[styles.pill, { backgroundColor: "#FEE2E2", marginBottom: 4 }]}>
              <Feather name="alert-circle" size={10} color="#EF4444" />
              <ThemedText type="caption" style={{ color: "#EF4444", fontWeight: "700", fontSize: 10, marginLeft: 3 }}>NOT ARRIVED — Grace period exceeded</ThemedText>
            </View>
          )}
          <ThemedText type="small" style={{ fontWeight: "700" }} numberOfLines={1}>{entry.user_name}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>{entry.user_role}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }} numberOfLines={1}>
            {entry.visit_type === "site" ? "🏗️ Site" : entry.visit_type === "office" ? "🏢 Office" : entry.visit_type === "others" ? "📍 Other" : "🤝 Meeting"}: {entry.location_name}
          </ThemedText>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          {!entry.is_dismissed && (
            <View style={[styles.pill, { backgroundColor: isOverdueGrace ? "#FEE2E2" : entry.is_transit_from_checkin ? "#DBEAFE" : urgency + "20" }]}>
              <Feather name={entry.is_transit_from_checkin ? "truck" : "clock"} size={10} color={urgency} />
              <ThemedText type="caption" style={{ color: urgency, fontWeight: "700", fontSize: 10, marginLeft: 3 }}>
                {entry.is_transit_from_checkin
                  ? `🚗 En Route · ~${eta}m`
                  : notDueYet
                    ? `${atRisk ? "At risk · " : "On time · "}${-entry.overdue_minutes}m left`
                    : `${entry.overdue_minutes}m overdue`}
              </ThemedText>
            </View>
          )}
          <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 10 }}>
            {entry.is_transit_from_checkin ? `ETA: ~${eta} min` : `Expected: ${entry.expected_by}`}
          </ThemedText>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={14} color={theme.textSecondary} />
        </View>
      </View>

      {expanded && (
        <View style={{ marginTop: 10, gap: 8 }}>
          {/* Overdue-grace alert */}
          {isOverdueGrace && !entry.is_dismissed && (
            <View style={[styles.noteBox, { backgroundColor: "#FEE2E2", borderLeftWidth: 3, borderLeftColor: "#EF4444" }]}>
              <Feather name="alert-triangle" size={13} color="#EF4444" />
              <ThemedText type="caption" style={{ color: "#991B1B", fontWeight: "700", marginLeft: 6, flex: 1 }}>
                🔴 NOT CHECKED IN AT DESTINATION — ETA was ~{eta} min + 30 min grace. Escalated to Distance Mismatch.
              </ThemedText>
            </View>
          )}

          {/* In-transit from check-in info */}
          {entry.is_transit_from_checkin && (
            <View style={[styles.noteBox, { backgroundColor: "#EFF6FF", borderLeftWidth: 3, borderLeftColor: "#3B82F6" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <Feather name="navigation-2" size={13} color="#3B82F6" />
                <ThemedText type="caption" style={{ color: "#1E40AF", fontWeight: "700", flex: 1 }}>🚗 IN TRANSIT</ThemedText>
              </View>
              <View style={{ marginLeft: 19, gap: 3 }}>
                <ThemedText type="caption" style={{ color: "#1E40AF" }}>📍 From: {entry.last_checkin_name || "Check-in Location"}</ThemedText>
                <ThemedText type="caption" style={{ color: "#1E40AF" }}>📍 To: {entry.location_name}</ThemedText>
                <ThemedText type="caption" style={{ color: "#3B82F6", fontWeight: "600", marginTop: 4 }}>
                  ⏱️ ETA: ~{eta} min · {entry.distance_from_checkin}m from check-in
                </ThemedText>
                <ThemedText type="caption" style={{ color: "#64748B", fontSize: 10, marginTop: 2 }}>
                  ⏰ Grace period: 30 min after arrival — must mark "I've Arrived" in app
                </ThemedText>
              </View>
            </View>
          )}

          {/* Overdue (not transit from check-in) */}
          {!entry.is_transit_from_checkin && (
            <View style={[styles.noteBox, { backgroundColor: "#FEF3C7", borderLeftWidth: 3, borderLeftColor: "#F59E0B" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Feather name="alert-circle" size={13} color="#F59E0B" />
                <ThemedText type="caption" style={{ color: "#92400E", fontWeight: "700", flex: 1 }}>⚠️ OVERDUE</ThemedText>
              </View>
              <ThemedText type="caption" style={{ color: "#92400E", marginLeft: 19, marginTop: 6 }}>
                Travel: ~{entry.travel_minutes}min + {GRACE_MINUTES}min grace = deadline {entry.expected_by}
                {entry.origin_coords && entry.destination_coords ? " (calculated from last GPS)" : " (estimated)"}
              </ThemedText>
            </View>
          )}

          {/* Route map: animated on the website, native map on the phone */}
          {hasRoute && expanded && (
            <AnimatedRouteMap
              originLat={entry.origin_coords!.latitude}
              originLon={entry.origin_coords!.longitude}
              destLat={entry.destination_coords!.latitude}
              destLon={entry.destination_coords!.longitude}
              etaMinutes={eta}
              name={entry.user_name}
            />
          )}

          <View style={styles.detailRow}>
            <Feather name="map-pin" size={12} color={theme.textSecondary} />
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginLeft: 6, flex: 1 }}>
              Visit logged: {fmtTime(entry.created_at)}
            </ThemedText>
          </View>

          {entry.location_address ? (
            <View style={styles.detailRow}>
              <Feather name="navigation" size={12} color={theme.textSecondary} />
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginLeft: 6, flex: 1 }} numberOfLines={2}>
                {entry.location_address}
              </ThemedText>
            </View>
          ) : null}

          {entry.is_dismissed && entry.dismiss_note ? (
            <View style={[styles.noteBox, { backgroundColor: "#DCFCE7" }]}>
              <Feather name="message-circle" size={12} color="#10B981" />
              <View style={{ flex: 1, marginLeft: 6 }}>
                <ThemedText type="caption" style={{ color: "#065F46", fontWeight: "600" }}>
                  Dismissed by {entry.dismissed_by_name ?? "HR"}
                </ThemedText>
                <ThemedText type="caption" style={{ color: "#065F46" }}>{entry.dismiss_note}</ThemedText>
              </View>
            </View>
          ) : null}

          {!entry.is_dismissed && (
            <Pressable style={[styles.dismissBtn, { backgroundColor: "#10B981" }]} onPress={() => onDismiss(entry)}>
              <Feather name="phone-call" size={13} color="#fff" />
              <ThemedText type="caption" style={{ color: "#fff", fontWeight: "700", marginLeft: 6 }}>HR Called — Dismiss Warning</ThemedText>
            </Pressable>
          )}

          {/* Navigation buttons */}
          {entry.destination_coords ? (
            <>
              {Platform.OS === "web" ? (
                <>
                  {entry.is_transit_from_checkin ? (
                    <>
                      <Pressable style={[styles.mapsBtn, { borderColor: "#3B82F6" }]}
                        onPress={() => (window as any).open(
                          entry.origin_coords && entry.destination_coords
                            ? `https://www.google.com/maps/dir/?api=1&origin=${entry.origin_coords.latitude},${entry.origin_coords.longitude}&destination=${entry.destination_coords!.latitude},${entry.destination_coords!.longitude}`
                            : `https://www.google.com/maps/dir/?api=1&destination=${entry.destination_coords!.latitude},${entry.destination_coords!.longitude}`,
                          "_blank"
                        )}>
                        <Feather name="external-link" size={12} color="#3B82F6" />
                        <ThemedText type="caption" style={{ color: "#3B82F6", fontWeight: "600", marginLeft: 4 }}>🗺️ Navigate from Last Location</ThemedText>
                      </Pressable>
                      <Pressable style={[styles.mapsBtn, { borderColor: "#60045d" }]}
                        onPress={() => (window as any).open(`https://www.google.com/maps/dir/?api=1&destination=${entry.destination_coords!.latitude},${entry.destination_coords!.longitude}`, "_blank")}>
                        <Feather name="external-link" size={12} color="#60045d" />
                        <ThemedText type="caption" style={{ color: "#60045d", fontWeight: "600", marginLeft: 4 }}>📍 Go to Destination</ThemedText>
                      </Pressable>
                    </>
                  ) : (
                    <Pressable style={[styles.mapsBtn, { borderColor: "#F59E0B" }]}
                      onPress={() => (window as any).open(`https://www.google.com/maps/dir/?api=1&destination=${entry.destination_coords!.latitude},${entry.destination_coords!.longitude}`, "_blank")}>
                      <Feather name="external-link" size={12} color="#F59E0B" />
                      <ThemedText type="caption" style={{ color: "#F59E0B", fontWeight: "600", marginLeft: 4 }}>📍 Navigate to Destination</ThemedText>
                    </Pressable>
                  )}
                </>
              ) : (
                <>
                  {entry.is_transit_from_checkin ? (
                    <>
                      <Pressable style={[styles.mapsBtn, { borderColor: "#3B82F6" }]}
                        onPress={async () => {
                          const { Linking } = await import("react-native");
                          if (entry.origin_coords && entry.destination_coords) {
                            const url = Platform.OS === "ios"
                              ? `maps://?saddr=${entry.origin_coords.latitude},${entry.origin_coords.longitude}&daddr=${entry.destination_coords.latitude},${entry.destination_coords.longitude}`
                              : `https://www.google.com/maps/dir/?api=1&origin=${entry.origin_coords.latitude},${entry.origin_coords.longitude}&destination=${entry.destination_coords.latitude},${entry.destination_coords.longitude}`;
                            Linking.openURL(url);
                          } else if (entry.destination_coords) {
                            const url = Platform.OS === "ios"
                              ? `maps://?daddr=${entry.destination_coords.latitude},${entry.destination_coords.longitude}`
                              : `https://www.google.com/maps/dir/?api=1&destination=${entry.destination_coords.latitude},${entry.destination_coords.longitude}`;
                            Linking.openURL(url);
                          }
                        }}>
                        <Feather name="external-link" size={12} color="#3B82F6" />
                        <ThemedText type="caption" style={{ color: "#3B82F6", fontWeight: "600", marginLeft: 4 }}>🗺️ Navigate from Last Location</ThemedText>
                      </Pressable>
                      <Pressable style={[styles.mapsBtn, { borderColor: "#60045d" }]}
                        onPress={async () => {
                          const { Linking } = await import("react-native");
                          if (entry.destination_coords) {
                            const url = Platform.OS === "ios"
                              ? `maps://?daddr=${entry.destination_coords.latitude},${entry.destination_coords.longitude}`
                              : `https://www.google.com/maps/dir/?api=1&destination=${entry.destination_coords.latitude},${entry.destination_coords.longitude}`;
                            Linking.openURL(url);
                          }
                        }}>
                        <Feather name="external-link" size={12} color="#60045d" />
                        <ThemedText type="caption" style={{ color: "#60045d", fontWeight: "600", marginLeft: 4 }}>📍 Go to Destination</ThemedText>
                      </Pressable>
                    </>
                  ) : (
                    <Pressable style={[styles.mapsBtn, { borderColor: "#F59E0B" }]}
                      onPress={async () => {
                        const { Linking } = await import("react-native");
                        if (entry.destination_coords) {
                          const url = Platform.OS === "ios"
                            ? `maps://?daddr=${entry.destination_coords.latitude},${entry.destination_coords.longitude}`
                            : `https://www.google.com/maps/dir/?api=1&destination=${entry.destination_coords.latitude},${entry.destination_coords.longitude}`;
                          Linking.openURL(url);
                        }
                      }}>
                      <Feather name="external-link" size={12} color="#F59E0B" />
                      <ThemedText type="caption" style={{ color: "#F59E0B", fontWeight: "600", marginLeft: 4 }}>📍 Navigate to Destination</ThemedText>
                    </Pressable>
                  )}
                </>
              )}
            </>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

// ─── Suspicious Card ──────────────────────────────────────────────────────────
function SuspiciousCard({ entry, onDismiss }: { entry: SuspiciousEntry; onDismiss: (e: SuspiciousEntry) => void }) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable
      style={[styles.card, { backgroundColor: theme.backgroundDefault, borderLeftColor: entry.is_dismissed ? "#9CA3AF" : "#EF4444" }]}
      onPress={() => setExpanded(e => !e)}
    >
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          {entry.is_dismissed && (
            <View style={[styles.pill, { backgroundColor: "#D1FAE5", marginBottom: 4 }]}>
              <Feather name="check-circle" size={10} color="#10B981" />
              <ThemedText type="caption" style={{ color: "#10B981", fontWeight: "700", fontSize: 10, marginLeft: 3 }}>Dismissed</ThemedText>
            </View>
          )}
          <ThemedText type="small" style={{ fontWeight: "700" }} numberOfLines={1}>{entry.user_name}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>{entry.user_role}</ThemedText>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          {!entry.is_dismissed && (
            <View style={[styles.pill, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="alert-triangle" size={10} color="#EF4444" />
              <ThemedText type="caption" style={{ color: "#EF4444", fontWeight: "700", fontSize: 10, marginLeft: 3 }}>
                {entry.distance_m}m away
              </ThemedText>
            </View>
          )}
          <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 10 }}>{entry.office_name}</ThemedText>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={14} color={theme.textSecondary} />
        </View>
      </View>

      {expanded && (
        <View style={{ marginTop: 10, gap: 6 }}>
          <View style={[styles.noteBox, { backgroundColor: "#FEE2E2" }]}>
            <Feather name="alert-circle" size={12} color="#EF4444" />
            <ThemedText type="caption" style={{ color: "#EF4444", marginLeft: 6, flex: 1, fontWeight: "600" }}>
              {entry.reason}
            </ThemedText>
          </View>
          <View style={styles.detailRow}>
            <Feather name="clock" size={12} color={theme.textSecondary} />
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginLeft: 6 }}>
              Check-in: {fmtTime(entry.checkin_time)}
            </ThemedText>
          </View>

          {entry.is_dismissed && entry.dismiss_note ? (
            <View style={[styles.noteBox, { backgroundColor: "#DCFCE7" }]}>
              <Feather name="message-circle" size={12} color="#10B981" />
              <View style={{ flex: 1, marginLeft: 6 }}>
                <ThemedText type="caption" style={{ color: "#065F46", fontWeight: "600" }}>
                  Dismissed by {entry.dismissed_by_name ?? "HR"}
                </ThemedText>
                <ThemedText type="caption" style={{ color: "#065F46" }}>{entry.dismiss_note}</ThemedText>
              </View>
            </View>
          ) : null}

          {!entry.is_dismissed && (
            <Pressable
              style={[styles.dismissBtn, { backgroundColor: "#10B981" }]}
              onPress={() => onDismiss(entry)}
            >
              <Feather name="phone-call" size={13} color="#fff" />
              <ThemedText type="caption" style={{ color: "#fff", fontWeight: "700", marginLeft: 6 }}>
                HR Called — Dismiss from Suspicious
              </ThemedText>
            </Pressable>
          )}
        </View>
      )}
    </Pressable>
  );
}

// ─── Log Card ─────────────────────────────────────────────────────────────────
function LogCard({ w, theme }: { w: any; theme: any }) {
  const isSusp = w.warning_type === "suspicious_activity";
  const color = w.status === "dismissed" ? "#10B981" : isSusp ? "#EF4444" : "#F59E0B";
  const bgColor = w.status === "dismissed" ? "#DCFCE7" : isSusp ? "#FEE2E2" : "#FEF3C7";
  return (
    <View style={[styles.logCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: color }]}>
      <View style={styles.logHeader}>
        <View style={{ flex: 1 }}>
          <ThemedText type="small" style={{ fontWeight: "700" }} numberOfLines={1}>{w.user_name}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>{w.user_role}</ThemedText>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <View style={[styles.pill, { backgroundColor: bgColor }]}>
            <ThemedText type="caption" style={{ color, fontWeight: "700", fontSize: 10 }}>
              {w.status === "dismissed" ? "Dismissed" : isSusp ? "Suspicious" : "Overdue"}
            </ThemedText>
          </View>
          <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 10 }}>{w.date}</ThemedText>
        </View>
      </View>
      {w.location_name ? (
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }}>
          📍 {w.location_name}
        </ThemedText>
      ) : null}
      {w.overdue_by_minutes ? (
        <ThemedText type="caption" style={{ color, marginTop: 2 }}>
          {isSusp
            ? `${w.overdue_by_minutes}m from office`
            : `${w.overdue_by_minutes}min overdue · Expected by ${w.expected_arrival ?? "—"}`}
          {!isSusp && w.duration_minutes ? ` · Travel: ~${w.duration_minutes}min + ${GRACE_MINUTES}min grace` : ""}
        </ThemedText>
      ) : null}
      {w.status === "dismissed" && (
        <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: "#E5E7EB" }}>
          <ThemedText type="caption" style={{ color: "#065F46", fontWeight: "600" }}>
            ✓ Dismissed by {w.dismissed_by_profile?.name ?? "HR"} at {fmtDateTime(w.dismissed_at)}
          </ThemedText>
          {w.dismiss_note ? (
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>{w.dismiss_note}</ThemedText>
          ) : null}
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
function InTransitScreenContent() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [tab, setTab] = useState<"transit" | "suspicious" | "log">("transit");
  const [transitEntries, setTransitEntries] = useState<TransitEntry[]>([]);
  const [suspiciousEntries, setSuspiciousEntries] = useState<SuspiciousEntry[]>([]);
  const [dailyLog, setDailyLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dismissTarget, setDismissTarget] = useState<TransitEntry | SuspiciousEntry | null>(null);
  const [dismissType, setDismissType] = useState<"transit" | "suspicious">("transit");
  const [loadError, setLoadError] = useState<string | null>(null);

  const { hasPermission } = usePermissions();
  // admins or live_tracking.view; the server limits rows to the caller's scope
  const isHR = hasPermission("live_tracking.view");

  const loadData = useCallback(async () => {
    setLoading(true);
    const clock = await BusinessClockService.get(true);
    const today = clock.date;
    const now = Date.parse(clock.now);

    try {
      // ── Profiles
      const { data: profiles, error: profilesError } = await fetchAllPages<any>((from, to) =>
        supabase.from("profiles").select("id, name, role").order("id").range(from, to));
      if (profilesError) throw profilesError;
      const pm: Record<string, { name: string; role: string }> = {};
      for (const p of profiles ?? []) pm[p.id] = { name: p.name, role: p.role || "—" };

      // ── Offices (for office name in transit display)
      const { data: offices } = await supabase
        .from("offices")
        .select("id, name, latitude, longitude, allowed_radius_meters, attendance_radius")
        .eq("is_active", true);

      // ── Today's PENDING and IN_TRANSIT field visits (not yet checked in)
      const { data: rawVisits, error: visitsError } = await fetchAllPages<any>((from, to) =>
        supabase
          .from("field_visits")
          .select("*")
          .eq("date", today)
          .in("status", ["PENDING", "IN_TRANSIT"])
          .order("created_at", { ascending: true })
          .order("id")
          .range(from, to));
      if (visitsError) throw visitsError;
      // A location re-submission replaces its source visit.
      const visits = collapseCurrentLocationSubmissions(rawVisits ?? []) as any[];

      // ── Existing dismissals for today
      const { data: warnings } = await supabase
        .from("transit_warnings")
        .select("*, dismissed_by_profile:dismissed_by(name)")
        .eq("date", today);

      const warningMap: Record<string, any> = {};
      for (const w of warnings ?? []) {
        if (w.field_visit_id) warningMap[w.field_visit_id + "_" + w.warning_type] = w;
        else warningMap[w.user_id + "_" + w.warning_type] = w;
      }

      // ── Latest GPS ping per user (to use as origin for travel time)
      // One latest RELIABLE position per person, computed by the server (no
      // 1000-row cap, mock / impossible-speed points excluded, IST day).
      const { data: checkedInRows } = await supabase
        .from("attendance_logs").select("user_id").eq("date", today).eq("status", "CHECKED_IN");
      const trackedIds = [...new Set([
        ...visits.map((v: any) => v.user_id),
        ...((checkedInRows ?? []) as any[]).map((a) => a.user_id),
      ])];
      const pingMap: Record<string, { latitude: number; longitude: number }> = {};
      if (trackedIds.length) {
        const latest: any = await supabase.rpc("rpc_latest_locations_for_users", { p_user_ids: trackedIds });
        if (!latest.error) {
          for (const p of (latest.data ?? []) as any[]) {
            if (p.latitude != null && p.longitude != null) {
              pingMap[p.user_id] = { latitude: Number(p.latitude), longitude: Number(p.longitude) };
            }
          }
        } else {
          // Older database without the RPC: IST wall-clock bounds (recorded_at is IST).
          const { data: pings } = await supabase
            .from("location_tracking")
            .select("user_id, latitude, longitude, recorded_at, quality_status")
            .gte("recorded_at", `${today}T00:00:00`)
            .lte("recorded_at", `${today}T23:59:59.999`)
            .in("user_id", trackedIds.slice(0, 200))
            .not("latitude", "is", null)
            .not("longitude", "is", null)
            .order("recorded_at", { ascending: false })
            .limit(1000);
          for (const p of (pings ?? []) as any[]) {
            const q = String(p.quality_status || "RELIABLE").toUpperCase();
            if (q === "MOCKED" || q === "IMPOSSIBLE_SPEED") continue;
            if (!pingMap[p.user_id]) pingMap[p.user_id] = { latitude: p.latitude, longitude: p.longitude };
          }
        }
      }

      // ── Build transit entries with real travel time per visit
      const DEFAULT_TRAVEL_MIN = 45;
      const transitList: TransitEntry[] = [];

      // Driving time per visit, fetched in parallel.
      const travelByVisit = new Map<string, number>(
        await Promise.all(visits.map(async (v: any): Promise<[string, number]> => {
          const origin = pingMap[v.user_id];
          const dest = v.destination_coords;
          if (!origin || !dest?.latitude || !dest?.longitude) return [v.id, DEFAULT_TRAVEL_MIN];
          try {
            return [v.id, await getDrivingMinutes(origin, dest)];
          } catch {
            return [v.id, DEFAULT_TRAVEL_MIN];
          }
        })),
      );

      for (const v of visits) {
        // The clock starts when the trip starts (tracking_started_at), not when
        // the visit was planned - a visit planned in the morning for the
        // afternoon is not "overdue" at noon.
        const startedMs = toUTC(v.tracking_started_at ?? v.created_at)?.getTime() ?? 0;
        if (!startedMs) continue;

        const destCoords = v.destination_coords ?? null;
        const originCoords = pingMap[v.user_id] ?? null;
        const travelMin = travelByVisit.get(v.id) ?? DEFAULT_TRAVEL_MIN;
        const createdMs = startedMs;

        const deadlineMs = createdMs + (travelMin + GRACE_MINUTES) * 60 * 1000;
        const overdueMin = Math.floor((now - deadlineMs) / 60000);

        const expectedBy = new Date(deadlineMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const w = warningMap[v.id + "_transit_overdue"];

        // Grace period deadline = created_at + travel + 30min grace
        // Once this passes without a check-in, card floats to top of distance mismatch
        const graceDl = createdMs + (travelMin + GRACE_MINUTES) * 60000;
        transitList.push({
          id: v.id,
          user_id: v.user_id,
          user_name: pm[v.user_id]?.name ?? "Unknown",
          user_role: pm[v.user_id]?.role ?? "—",
          location_name: v.location_name,
          location_address: v.location_address ?? null,
          origin_coords: originCoords,
          destination_coords: destCoords,
          visit_type: v.visit_type,
          created_at: v.created_at,
          status: v.status,
          checkin_time: v.checkin_time ?? null,
          travel_minutes: travelMin,
          overdue_minutes: overdueMin,
          expected_by: expectedBy,
          google_eta_minutes: travelMin,
          overdue_grace_deadline_ms: graceDl,
          is_dismissed: w?.status === "dismissed",
          dismiss_note: w?.dismiss_note ?? null,
          dismissed_by_name: w?.dismissed_by_profile?.name ?? null,
          warning_id: w?.id ?? null,
        });

        // Auto-create a warning record only once the visit is actually overdue
        if (!w && overdueMin >= 0) {
          void TransitWarningService.save(null, {
            user_id: v.user_id,
            date: today,
            warning_type: "transit_overdue",
            field_visit_id: v.id,
            location_name: v.location_name,
            destination_address: v.location_address ?? null,
            created_at_time: fmtTime(v.created_at),
            expected_arrival: expectedBy,
            overdue_by_minutes: overdueMin,
            duration_minutes: travelMin,
            status: "active",
          }).catch((error: unknown) => {
            console.error("[Transit] Unable to persist overdue warning", error);
          });
        }
      }

      // ── Detect users IN TRANSIT from check-in location (outside 50m radius)
      // Users who have checked in but their last GPS ping shows they've moved >50m away
      // Also check if they have PENDING meetings to show in transit
      const { data: attendanceWithCheckin } = await supabase
        .from("attendance_logs")
        .select("id, user_id, checkin_location, checkin_time, office_id, offices:office_id(attendance_radius)")
        .eq("date", today)
        .eq("status", "CHECKED_IN");

      const { data: fieldVisitsCheckedIn } = await supabase
        .from("field_visits")
        .select("id, user_id, checkin_location, checkin_time, location_name, status")
        .eq("date", today)
        .in("status", ["CHECKED_IN", "PENDING", "IN_TRANSIT"]);

      // Check each checked-in user if they've moved >50m from their check-in location
      for (const att of (attendanceWithCheckin ?? [])) {
        const lastPing = pingMap[att.user_id];
        const checkinLoc = att.checkin_location;
        if (!lastPing || !checkinLoc?.latitude || !checkinLoc?.longitude) continue;

        // Calculate distance from check-in location
        const R = 6371000;
        const dLat = ((lastPing.latitude - checkinLoc.latitude) * Math.PI) / 180;
        const dLon = ((lastPing.longitude - checkinLoc.longitude) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos((checkinLoc.latitude * Math.PI) / 180) *
          Math.cos((lastPing.latitude * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2;
        const distM = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

        // If user is more than 50m from check-in location AND has PENDING meetings, show in transit
        const departureRadius = Number((att as any).offices?.attendance_radius);
        if (!Number.isFinite(departureRadius) || departureRadius <= 0) continue;
        if (distM <= departureRadius) continue;

        // Find ALL PENDING meetings for this user (not just the next one)
        const pendingVisits = visits.filter((v: any) => v.user_id === att.user_id && (v.status === "PENDING" || v.status === "IN_TRANSIT"));
        
        if (pendingVisits.length === 0) continue;

        // Process each pending visit
        for (const nextVisit of pendingVisits) {
          const destCoords = nextVisit.destination_coords;
          let etaMin = DEFAULT_TRAVEL_MIN;
          if (destCoords) {
            etaMin = await getDrivingMinutes(lastPing, destCoords);
          }

          const w = warningMap[nextVisit.id + "_transit_from_checkin"];
          const office = (offices ?? []).find((o: any) => o.id === att.office_id);

          transitList.push({
            id: `transit-${att.id}-${nextVisit.id}`,
            user_id: att.user_id,
            user_name: pm[att.user_id]?.name ?? "Unknown",
            user_role: pm[att.user_id]?.role ?? "—",
            location_name: nextVisit.location_name,
            location_address: nextVisit.location_address ?? null,
            origin_coords: lastPing,
            destination_coords: destCoords,
            visit_type: nextVisit.visit_type,
            created_at: att.checkin_time,
            status: "PENDING",
            checkin_time: att.checkin_time,
            travel_minutes: etaMin,
            overdue_minutes: 0,
            expected_by: `~${etaMin} min`,
            is_dismissed: w?.status === "dismissed",
            dismiss_note: w?.dismiss_note ?? null,
            dismissed_by_name: w?.dismissed_by_profile?.name ?? null,
            warning_id: w?.id ?? null,
            is_transit_from_checkin: true,
            last_checkin_location: checkinLoc,
            last_checkin_name: office?.name ?? "Office",
            distance_from_checkin: distM,
            eta_minutes: etaMin,
            google_eta_minutes: etaMin,
            // Grace: depart time + eta + 30 min to mark "I've Arrived"
            overdue_grace_deadline_ms: (toUTC(att.checkin_time)?.getTime() ?? now) + (etaMin + GRACE_MINUTES) * 60000,
          });

          if (!w) {
            void TransitWarningService.save(null, {
              user_id: att.user_id,
              date: today,
              warning_type: "transit_from_checkin",
              field_visit_id: nextVisit.id,
              location_name: nextVisit.location_name,
              destination_address: nextVisit.location_address ?? null,
              created_at_time: fmtTime(att.checkin_time),
              expected_arrival: `~${etaMin} min`,
              overdue_by_minutes: distM,
              duration_minutes: etaMin,
              status: "active",
            }).catch((error: unknown) => {
              console.error("[Transit] Unable to persist journey warning", error);
            });
          }
        }
      }

      // Most urgent first: overdue (longest first), then at risk, then on time.
      transitList.sort((x, y) => Number(x.is_dismissed) - Number(y.is_dismissed) || y.overdue_minutes - x.overdue_minutes);
      setTransitEntries(transitList);

      // ── Suspicious activity: a check-in made from OUTSIDE the office area.
      // Same limit the check-in itself uses (office radius, 100 m by default).
      // Walking away after checking in (lunch, field work) is not suspicious.
      const { data: attLogs } = await supabase
        .from("attendance_logs")
        .select("*")
        .eq("date", today)
        .in("status", ["CHECKED_IN", "CHECKED_OUT"]);

      // offices already loaded above

      const suspList: SuspiciousEntry[] = [];

      for (const a of attLogs ?? []) {
        const office = (offices ?? []).find((o: any) => o.id === a.office_id);
        if (!office || office.latitude == null || office.longitude == null) continue;
        const officeRadius = Number(office.allowed_radius_meters ?? office.attendance_radius ?? 100);
        const allowedRadius = Number.isFinite(officeRadius) && officeRadius > 0 ? officeRadius : 100;

        const cLat = a.checkin_location?.latitude;
        const cLon = a.checkin_location?.longitude;

        let reason: string | null = null;
        let distanceM = 0;

        if (cLat != null && cLon != null) {
          const R = 6371000;
          const dLat = ((cLat - office.latitude) * Math.PI) / 180;
          const dLon = ((cLon - office.longitude) * Math.PI) / 180;
          const aa = Math.sin(dLat / 2) ** 2 + Math.cos((office.latitude * Math.PI) / 180) * Math.cos((cLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
          const d = Math.round(R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa)));
          if (d > allowedRadius) { reason = `Checked in ${d} m from ${office.name} (allowed ${allowedRadius} m)`; distanceM = d; }
        }

        if (!reason) continue;

        const w = (warnings ?? []).find(
          (ww: any) => ww.user_id === a.user_id && ww.warning_type === "suspicious_activity" && ww.date === today
        );

        suspList.push({
          id: a.id,
          user_id: a.user_id,
          user_name: pm[a.user_id]?.name ?? "Unknown",
          user_role: pm[a.user_id]?.role ?? "—",
          office_name: office.name,
          distance_m: distanceM,
          checkin_time: a.checkin_time,
          reason,
          is_dismissed: w?.status === "dismissed",
          dismiss_note: w?.dismiss_note ?? null,
          dismissed_by_name: w?.dismissed_by_profile?.name ?? null,
          warning_id: w?.id ?? null,
        });

        if (!w) {
          void TransitWarningService.save(null, {
            user_id: a.user_id,
            date: today,
            warning_type: "suspicious_activity",
            location_name: office.name,
            overdue_by_minutes: distanceM,
            status: "active",
          }).catch((error: unknown) => {
            console.error("[Transit] Unable to persist suspicious warning", error);
          });
        }
      }

      setSuspiciousEntries(suspList);

      // ── Daily log — last 7 days
      const sevenDaysAgo = addBusinessDays(today, -7);
      const { data: logData } = await fetchAllPages<any>((from, to) =>
        supabase
          .from("transit_warnings")
          .select("*, dismissed_by_profile:dismissed_by(name)")
          .gte("date", sevenDaysAgo)
          .order("date", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      );

      setDailyLog(
        (logData ?? []).map((w: any) => ({
          ...w,
          user_name: pm[w.user_id]?.name ?? "Unknown",
          user_role: pm[w.user_id]?.role ?? "—",
        }))
      );
      setLoadError(null);
    } catch (err: any) {
      console.error("InTransit load error:", err);
      setLoadError(err?.message || "In-transit data could not be loaded.");
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));
  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const handleDismiss = async (note: string) => {
    if (!dismissTarget || !user?.id) return;
    const today = await BusinessClockService.getDate(true);
    const wType = dismissType === "transit" ? "transit_overdue" : "suspicious_activity";

    const { data: existing } = await supabase
      .from("transit_warnings")
      .select("id")
      .eq("user_id", dismissTarget.user_id)
      .eq("date", today)
      .eq("warning_type", wType)
      .maybeSingle();

    const payload = {
      status: "dismissed",
      dismissed_by: user.id,
      dismissed_at: new Date().toISOString(),
      dismiss_note: note || "HR called and verified.",
    };

    if (existing?.id) {
      await TransitWarningService.save(existing.id, payload);
    } else {
      await TransitWarningService.save(null, {
        user_id: dismissTarget.user_id,
        date: today,
        warning_type: wType,
        field_visit_id: dismissType === "transit" ? (dismissTarget as TransitEntry).id : null,
        location_name: dismissType === "transit"
          ? (dismissTarget as TransitEntry).location_name
          : (dismissTarget as SuspiciousEntry).office_name,
        ...payload,
      });
    }

    setDismissTarget(null);
    loadData();
  };

  const activeTransit = transitEntries.filter(e => !e.is_dismissed);
  const dismissedTransit = transitEntries.filter(e => e.is_dismissed);
  const activeSusp = suspiciousEntries.filter(e => !e.is_dismissed);
  const dismissedSusp = suspiciousEntries.filter(e => e.is_dismissed);

  const TABS = [
    { key: "transit" as const, label: "In Transit", count: activeTransit.length, color: "#F59E0B" },
    { key: "suspicious" as const, label: "Suspicious", count: activeSusp.length, color: "#EF4444" },
    { key: "log" as const, label: "Daily Log", count: dailyLog.length, color: "#6B7280" },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{ padding: Spacing.md, paddingBottom: 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
    >
      {/* Summary */}
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: "#FEF3C7" }]}>
          <Feather name="navigation" size={18} color="#F59E0B" />
          <ThemedText type="h3" style={{ color: "#F59E0B", marginTop: 4 }}>{activeTransit.length}</ThemedText>
          <ThemedText type="caption" style={{ color: "#92400E", fontWeight: "600", textAlign: "center" }}>
            {"Overdue\nVisits"}
          </ThemedText>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: "#FEE2E2" }]}>
          <Feather name="alert-triangle" size={18} color="#EF4444" />
          <ThemedText type="h3" style={{ color: "#EF4444", marginTop: 4 }}>{activeSusp.length}</ThemedText>
          <ThemedText type="caption" style={{ color: "#991B1B", fontWeight: "600", textAlign: "center" }}>
            {"Suspicious\nActivity"}
          </ThemedText>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: "#DCFCE7" }]}>
          <Feather name="check-circle" size={18} color="#10B981" />
          <ThemedText type="h3" style={{ color: "#10B981", marginTop: 4 }}>
            {dismissedTransit.length + dismissedSusp.length}
          </ThemedText>
          <ThemedText type="caption" style={{ color: "#065F46", fontWeight: "600", textAlign: "center" }}>
            {"Dismissed\nToday"}
          </ThemedText>
        </View>
      </View>

      {loadError ? (
        <View style={{ padding: 10, borderRadius: 8, backgroundColor: "#FEE2E2", marginBottom: 8 }}>
          <ThemedText type="caption" style={{ color: "#991B1B", fontWeight: "700" }}>
            In-transit data may be incomplete: {loadError}
          </ThemedText>
        </View>
      ) : null}

      {/* Tabs */}
      <View style={styles.tabRow}>
        {TABS.map(t => (
          <Pressable
            key={t.key}
            style={[styles.tab, tab === t.key && { backgroundColor: t.color }]}
            onPress={() => setTab(t.key)}
          >
            <ThemedText type="caption" style={{ color: tab === t.key ? "#fff" : t.color, fontWeight: "700" }}>
              {t.label} ({t.count})
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: 40 }} />
      ) : tab === "transit" ? (
        <>
          <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
            Every planned or travelling visit today. Expected arrival = trip start + driving time from the
            latest reliable GPS position + {GRACE_MINUTES} min grace. Green: on time · Amber: at risk (under {AT_RISK_MINUTES} min left) · Red: overdue.
          </ThemedText>
          {activeTransit.length === 0 && dismissedTransit.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: "#DCFCE7" }]}>
              <Feather name="navigation" size={28} color="#10B981" />
              <ThemedText type="caption" style={{ color: "#065F46", marginTop: 8, fontWeight: "600" }}>
                No overdue visits right now
              </ThemedText>
            </View>
          ) : (
            <View style={{ gap: Spacing.sm }}>
              {activeTransit.map(e => (
                <TransitCard key={e.id} entry={e} onDismiss={entry => { setDismissTarget(entry); setDismissType("transit"); }} />
              ))}
              {dismissedTransit.length > 0 && (
                <>
                  <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: Spacing.sm }}>
                    Dismissed today ({dismissedTransit.length})
                  </ThemedText>
                  {dismissedTransit.map(e => (
                    <TransitCard key={e.id} entry={e} onDismiss={() => {}} />
                  ))}
                </>
              )}
            </View>
          )}
        </>
      ) : tab === "suspicious" ? (
        <>
          <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
            Check-in GPS or live ping is significantly far from the registered office.
          </ThemedText>
          {activeSusp.length === 0 && dismissedSusp.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: "#DCFCE7" }]}>
              <Feather name="shield" size={28} color="#10B981" />
              <ThemedText type="caption" style={{ color: "#065F46", marginTop: 8, fontWeight: "600" }}>
                No suspicious activity today
              </ThemedText>
            </View>
          ) : (
            <View style={{ gap: Spacing.sm }}>
              {activeSusp.map(e => (
                <SuspiciousCard key={e.id} entry={e} onDismiss={entry => { setDismissTarget(entry); setDismissType("suspicious"); }} />
              ))}
              {dismissedSusp.length > 0 && (
                <>
                  <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: Spacing.sm }}>
                    Dismissed today ({dismissedSusp.length})
                  </ThemedText>
                  {dismissedSusp.map(e => (
                    <SuspiciousCard key={e.id} entry={e} onDismiss={() => {}} />
                  ))}
                </>
              )}
            </View>
          )}
        </>
      ) : (
        // Daily Log
        <>
          <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
            Last 7 days — all transit warnings and suspicious flags with travel time details and dismissal notes.
          </ThemedText>
          {dailyLog.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.backgroundDefault }]}>
              <Feather name="archive" size={28} color={theme.textSecondary} />
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 8 }}>No logs yet</ThemedText>
            </View>
          ) : (
            <View style={{ gap: Spacing.sm }}>
              {dailyLog.map(w => <LogCard key={w.id} w={w} theme={theme} />)}
            </View>
          )}
        </>
      )}

      <DismissModal
        visible={!!dismissTarget}
        name={dismissTarget
          ? (dismissType === "transit"
            ? (dismissTarget as TransitEntry).user_name + " — " + (dismissTarget as TransitEntry).location_name
            : (dismissTarget as SuspiciousEntry).user_name)
          : ""}
        onConfirm={handleDismiss}
        onCancel={() => setDismissTarget(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md },
  summaryCard: { flex: 1, alignItems: "center", padding: Spacing.md, borderRadius: BorderRadius.md, gap: 2 },
  tabRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md },
  tab: {
    flex: 1, alignItems: "center", justifyContent: "center",
    padding: Spacing.md, borderRadius: BorderRadius.md,
    borderWidth: 1.5, borderColor: "transparent",
  },
  card: { borderRadius: BorderRadius.md, borderLeftWidth: 4, padding: Spacing.md },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  pill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 2, borderRadius: BorderRadius.full },
  detailRow: { flexDirection: "row", alignItems: "flex-start" },
  noteBox: { flexDirection: "row", alignItems: "flex-start", padding: 8, borderRadius: BorderRadius.sm },
  dismissBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 10, borderRadius: BorderRadius.md, marginTop: 4 },
  mapsBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 8, borderRadius: BorderRadius.md, borderWidth: 1, marginTop: 4 },
  emptyCard: { alignItems: "center", padding: Spacing.xl, borderRadius: BorderRadius.md, marginTop: 16 },
  logCard: { borderRadius: BorderRadius.md, borderLeftWidth: 4, padding: Spacing.md },
  logHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalBox: { width: "100%", borderRadius: BorderRadius.xl, padding: Spacing.xl },
  noteInput: { borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: 14, minHeight: 80, textAlignVertical: "top", marginBottom: 16 },
  modalBtns: { flexDirection: "row", gap: Spacing.sm },
  modalBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", padding: Spacing.md, borderRadius: BorderRadius.md },
});

export default function InTransitScreen() {
  return (
    <ModuleErrorBoundary moduleName="In-Transit Tracker">
      <InTransitScreenContent />
    </ModuleErrorBoundary>
  );
}
