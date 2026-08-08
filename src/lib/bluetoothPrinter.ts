/**
 * Compatibility façade for thermal printer helpers.
 * New code should prefer `printService` + `bluetoothPeripherals` directly.
 */

export {
  pairPrinter,
  pairPrinter as connectPrinter,
  disconnectPrinter,
  isPrinterConnected,
  getConnectedPrinterName,
  sendRawBytes,
  sendPrinterBytes,
  reconnectPrinter,
  forgetPrinter,
} from './bluetoothPeripherals';

export {
  printReceipt,
  printTestPage,
  printRawBytes,
  buildEscPosReceipt,
  convertPDFReceiptToESCPOS,
  type ReceiptData,
  type EscPosReceiptData,
} from './printService';
