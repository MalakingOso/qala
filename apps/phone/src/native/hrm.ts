/* BLE heart-rate strap glue over Heart Rate Service 0x180D,
 * characteristic 0x2A37. Optional; the engine runs on rTSS + sRPE without
 * it, and HR-zone charts hide when no HR is recorded (PLAN 6.4). */

import { BleClient } from "@capacitor-community/bluetooth-le";

const HR_SERVICE = "180d";
const HR_MEASUREMENT = "2a37";

export type HrHandler = (bpm: number, at: number) => void;

function parseHr(value: DataView | undefined): number | null {
  if (!value || value.byteLength < 2) return null;
  const flags = value.getUint8(0);
  const wide = (flags & 0x01) !== 0;
  return wide ? value.getUint16(1, true) : value.getUint8(1);
}

export async function connectHrStrap(
  deviceId: string,
  onHr: HrHandler,
): Promise<() => Promise<void>> {
  await BleClient.requestPermissions();
  await BleClient.connect({ deviceId });
  await BleClient.startNotifications({
    deviceId,
    service: HR_SERVICE,
    characteristic: HR_MEASUREMENT,
  });
  const sub = await BleClient.addListener(
    "onCharacteristicChanged",
    (event) => {
      const bpm = parseHr(event.value);
      if (bpm !== null) onHr(bpm, Date.now());
    },
  );
  return () => sub.remove();
}

export async function requestHrDevice(): Promise<string> {
  await BleClient.requestPermissions();
  const device = await BleClient.requestDevice({ services: [HR_SERVICE] });
  return device.deviceId;
}
