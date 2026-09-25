import { Linking, Platform } from 'react-native';

export async function isNotificationPermissionGranted(): Promise<boolean> { return true; }
export async function requestNotificationPermission(): Promise<boolean> { return true; }
export async function registerDevicePushToken(): Promise<string | null> { return "dummy_token"; }
export async function deactivateCurrentDevicePushToken(): Promise<void> {}
export function scheduleLocalNotification(title: string, body: string, data?: any): Promise<void> { return Promise.resolve(); }
export async function scheduleGeofenceEntryNotification(officeName: string): Promise<void> {}
export async function scheduleGeofenceExitNotification(officeName: string): Promise<void> {}
export async function scheduleAttendanceReminder(dateStr: string, timeStr: string, officeName: string, isCheckOut: boolean): Promise<void> {}
export async function scheduleAttendanceReminders(dateStr: string, timeStr: string, officeName: string, isCheckOut: boolean): Promise<void> {}
export async function cancelAllAttendanceReminders(): Promise<void> {}
export async function scheduleIdleReminder(idleMinutes: number): Promise<void> {}
export async function cancelIdleReminder(): Promise<void> {}
export function initializeNotificationHandlers(): void {}
export function initializeNotificationInfrastructure(): void {}
export function notifyJourneyEvent(): void {}
export function notifyLocationProblem(): void {}
export function handleNotificationResponse(): void {}
