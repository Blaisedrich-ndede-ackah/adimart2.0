interface BluetoothRemoteGATTCharacteristic {
  uuid: string;
  service: BluetoothRemoteGATTService;
  properties: BluetoothCharacteristicProperties;
  value?: DataView;
  readValue(): Promise<DataView>;
  writeValue(value: BufferSource): Promise<void>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface BluetoothCharacteristicProperties {
  broadcast: boolean;
  read: boolean;
  writeWithoutResponse: boolean;
  write: boolean;
  notify: boolean;
  indicate: boolean;
  authenticatedSignedWrites: boolean;
  reliableWrite: boolean;
  writableAuxiliaries: boolean;
}

interface BluetoothRemoteGATTService {
  uuid: string;
  device: BluetoothDevice;
  isPrimary: boolean;
  getCharacteristic(characteristicUUID: string): Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics(characteristicUUID?: string): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTServer {
  device: BluetoothDevice;
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(serviceUUID: string): Promise<BluetoothRemoteGATTService>;
  getPrimaryServices(serviceUUID?: string): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothDevice {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
  watchAdvertisements?(): Promise<void>;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface BluetoothRequestDeviceFilter {
  services?: string[];
  name?: string;
  namePrefix?: string;
}

interface RequestDeviceOptions {
  filters?: BluetoothRequestDeviceFilter[];
  optionalServices?: string[];
  acceptAllDevices?: boolean;
}

interface Bluetooth {
  getAvailability(): Promise<boolean>;
  requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
  /** Previously permitted devices (Chromium). Used for silent reconnect. */
  getDevices?(): Promise<BluetoothDevice[]>;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface Navigator {
  bluetooth: Bluetooth;
}
