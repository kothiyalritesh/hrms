// MapPickerModal.tsx — native platform only (iOS / Android via react-native-webview)
import React, { useState, useEffect } from "react";
import {
  Modal, View, StyleSheet, TouchableOpacity,
  ActivityIndicator, TextInput, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { WebView } from "react-native-webview";

export interface MapPickResult {
  latitude: number;
  longitude: number;
  displayName: string;
}

interface Props {
  visible: boolean;
  initialLat: number;
  initialLon: number;
  initialName: string;
  onConfirm: (result: MapPickResult) => void;
  onClose: () => void;
}

function buildMapHtml(lat: number, lon: number, label: string): string {
  const safeLabel = label.replace(/'/g, "\\'").replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body,#map{width:100%;height:100%;overflow:hidden}
  #hint{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);
    background:rgba(0,0,0,0.72);color:#fff;font-size:13px;padding:8px 16px;
    border-radius:20px;z-index:9999;white-space:nowrap;pointer-events:none;font-family:sans-serif}
</style>
</head>
<body>
<div id="map"></div>
<div id="hint">Drag the pin or tap to adjust location</div>
<script>
  var map = L.map('map',{zoomControl:true}).setView([${lat},${lon}],16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© OpenStreetMap',maxZoom:19
  }).addTo(map);
  var icon = L.divIcon({
    html:'<div style="font-size:32px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4))">📍<\/div>',
    iconAnchor:[16,32],className:''
  });
  var marker = L.marker([${lat},${lon}],{draggable:true,icon:icon}).addTo(map);
  marker.bindPopup('${safeLabel}').openPopup();
  function postCoords(){
    var ll = marker.getLatLng();
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'coords',lat:ll.lat,lon:ll.lng}));
  }
  marker.on('dragend', postCoords);
  map.on('click', function(e){ marker.setLatLng(e.latlng); postCoords(); });
  setTimeout(postCoords, 600);
<\/script>
</body>
</html>`;
}

export default function MapPickerModal({ visible, initialLat, initialLon, initialName, onConfirm, onClose }: Props) {
  const [pickedLat, setPickedLat] = useState(initialLat);
  const [pickedLon, setPickedLon] = useState(initialLon);
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [centerLat, setCenterLat] = useState(initialLat);
  const [centerLon, setCenterLon] = useState(initialLon);
  const [centerName, setCenterName] = useState(initialName);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (visible) {
      setPickedLat(initialLat); setPickedLon(initialLon);
      setCenterLat(initialLat); setCenterLon(initialLon);
      setCenterName(initialName); setSearchText(""); setReady(false);
      setMapKey((k) => k + 1);
    }
  }, [visible, initialLat, initialLon, initialName]);

  const handleSearch = async () => {
    const q = searchText.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + " India")}&format=json&limit=1&countrycodes=in`,
        { headers: { "Accept-Language": "en", "User-Agent": "RealtyHRMS/1.0" } }
      );
      const data = await res.json();
      if (data?.[0]) {
        const lat = parseFloat(data[0].lat), lon = parseFloat(data[0].lon);
        const name = data[0].display_name?.split(",")[0] || q;
        setCenterLat(lat); setCenterLon(lon); setCenterName(name);
        setPickedLat(lat); setPickedLon(lon); setReady(false);
        setMapKey((k) => k + 1);
      }
    } catch {}
    setSearching(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} presentationStyle="fullScreen">
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} style={s.closeBtn}>
            <Feather name="x" size={20} color="#374151" />
          </TouchableOpacity>
          <ThemedText style={s.title}>Pin Location on Map</ThemedText>
          <TouchableOpacity style={s.confirmBtn} onPress={() => onConfirm({ latitude: pickedLat, longitude: pickedLon, displayName: centerName })}>
            <Feather name="check" size={16} color="#fff" />
            <ThemedText style={s.confirmBtnText}>Confirm</ThemedText>
          </TouchableOpacity>
        </View>

        <View style={s.searchRow}>
          <Feather name="search" size={15} color="#9CA3AF" style={{ marginRight: 8 }} />
          <TextInput
            style={s.searchInput} value={searchText} onChangeText={setSearchText}
            placeholder="Search city, area or landmark…" placeholderTextColor="#9CA3AF"
            returnKeyType="search" onSubmitEditing={handleSearch}
          />
          {searching
            ? <ActivityIndicator size="small" color="#60045d" />
            : <TouchableOpacity onPress={handleSearch} style={s.goBtn}><ThemedText style={s.goBtnText}>Go</ThemedText></TouchableOpacity>
          }
        </View>

        <View style={{ flex: 1 }}>
          {!ready && (
            <View style={[StyleSheet.absoluteFill, s.loader]}>
              <ActivityIndicator color="#60045d" size="large" />
              <ThemedText style={s.loaderText}>Loading map…</ThemedText>
            </View>
          )}
          <WebView
            key={mapKey}
            source={{ html: buildMapHtml(centerLat, centerLon, centerName) }}
            style={{ flex: 1 }}
            onLoadEnd={() => setReady(true)}
            onMessage={(e) => {
              try {
                const data = JSON.parse(e.nativeEvent.data);
                if (data?.type === "coords") { setPickedLat(data.lat); setPickedLon(data.lon); }
              } catch {}
            }}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={["*"]}
          />
        </View>

        <View style={s.footer}>
          <Feather name="map-pin" size={13} color="#60045d" />
          <ThemedText style={s.footerText}>{pickedLat.toFixed(6)}, {pickedLon.toFixed(6)}</ThemedText>
          <ThemedText style={s.footerHint}>Tap map or drag pin to adjust</ThemedText>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: Platform.OS === "ios" ? 56 : 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: "#E5E7EB", backgroundColor: "#fff",
  },
  closeBtn: { padding: 4, width: 44 },
  title: { flex: 1, fontSize: 16, fontWeight: "700", color: "#111827", textAlign: "center" },
  confirmBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#60045d", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
  },
  confirmBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  searchRow: {
    flexDirection: "row", alignItems: "center",
    margin: 12, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: "#F3F4F6", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB",
  },
  searchInput: { flex: 1, fontSize: 14, color: "#111827" },
  goBtn: { backgroundColor: "#60045d", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
  goBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  loader: { alignItems: "center", justifyContent: "center", backgroundColor: "#F9FAFB", zIndex: 10 },
  loaderText: { marginTop: 10, color: "#6B7280", fontSize: 13 },
  footer: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: "#F9FAFB", borderTopWidth: 1, borderTopColor: "#E5E7EB",
  },
  footerText: { fontSize: 12, color: "#60045d", fontWeight: "600" },
  footerHint: { fontSize: 11, color: "#9CA3AF", marginLeft: "auto" },
});
