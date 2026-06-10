import { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { Camera, CameraOff, Keyboard, RefreshCw } from 'lucide-react';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  active: boolean;
}

export default function BarcodeScanner({ onScan, active }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const lastScannedRef = useRef<string>('');
  const lastScanTimeRef = useRef<number>(0);

  const [cameraError, setCameraError] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');

  const stopCamera = useCallback(() => {
    if (readerRef.current) {
      readerRef.current.reset();
      readerRef.current = null;
    }
    setIsScanning(false);
  }, []);

  const startCamera = useCallback(async (deviceId?: string) => {
    setCameraError('');
    setIsScanning(false);

    try {
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      // Get available cameras
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setAvailableCameras(videoDevices);

      // Find back camera if no specific device selected
      let cameraId = deviceId;
      if (!cameraId) {
        const backCamera = videoDevices.find(d => 
          d.label.toLowerCase().includes('back') || 
          d.label.toLowerCase().includes('rear') ||
          d.label.toLowerCase().includes('environment')
        );
        cameraId = backCamera?.deviceId || videoDevices[videoDevices.length - 1]?.deviceId;
      }

      if (cameraId) {
        setSelectedCameraId(cameraId);
      }

      if (!videoRef.current) {
        setCameraError('Video element not ready');
        return;
      }

      // Start continuous decoding
      await reader.decodeFromVideoDevice(
        cameraId || null,
        videoRef.current,
        (result, error) => {
          if (result) {
            const code = result.getText();
            const now = Date.now();
            
            // Debounce: prevent same code within 2 seconds
            if (code !== lastScannedRef.current || now - lastScanTimeRef.current > 2000) {
              lastScannedRef.current = code;
              lastScanTimeRef.current = now;
              onScan(code);
            }
          }
          
          if (error && !(error instanceof NotFoundException)) {
            // Only log non-expected errors
            console.debug('Scan frame error:', error);
          }
        }
      );

      setIsScanning(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
        setCameraError('Camera permission denied. Please allow camera access in your browser settings.');
      } else if (msg.includes('NotFoundError') || msg.includes('Requested device not found')) {
        setCameraError('No camera found on this device.');
      } else if (msg.includes('NotReadableError')) {
        setCameraError('Camera is in use by another application.');
      } else {
        setCameraError('Camera error: ' + msg);
      }
    }
  }, [onScan]);

  const switchCamera = useCallback(() => {
    if (availableCameras.length <= 1) return;
    
    const currentIndex = availableCameras.findIndex(c => c.deviceId === selectedCameraId);
    const nextIndex = (currentIndex + 1) % availableCameras.length;
    const nextCamera = availableCameras[nextIndex];
    
    stopCamera();
    setTimeout(() => startCamera(nextCamera.deviceId), 100);
  }, [availableCameras, selectedCameraId, stopCamera, startCamera]);

  useEffect(() => {
    if (active) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [active, startCamera, stopCamera]);

  const handleManualSubmit = () => {
    if (manualBarcode.trim()) {
      onScan(manualBarcode.trim());
      setManualBarcode('');
      setShowManualInput(false);
    }
  };

  const handleRetry = () => {
    stopCamera();
    setTimeout(() => startCamera(), 100);
  };

  return (
    <div className="relative bg-black rounded-xl overflow-hidden">
      {cameraError ? (
        <div className="flex flex-col items-center justify-center h-40 bg-gray-900 p-4">
          <CameraOff className="w-8 h-8 text-gray-500 mb-2" />
          <p className="text-gray-400 text-xs text-center mb-3">{cameraError}</p>
          <button
            onClick={handleRetry}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm touch-target flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Retry Camera
          </button>
        </div>
      ) : (
        <div className="relative h-44">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
            autoPlay
          />

          {/* Scan crosshair overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-52 h-28 relative">
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-accent rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-accent rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-accent rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-accent rounded-br-lg" />
              
              {/* Scanning line animation */}
              {isScanning && (
                <div className="absolute inset-x-4 top-1/2 -translate-y-1/2">
                  <div className="h-0.5 bg-red-500 animate-pulse shadow-lg shadow-red-500/50" />
                </div>
              )}
            </div>
          </div>

          {/* Status indicators */}
          <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${isScanning ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
              <span className="text-white text-[10px] bg-black/60 px-1.5 py-0.5 rounded">
                {isScanning ? 'Point at barcode' : 'Starting camera...'}
              </span>
            </div>
            
            {availableCameras.length > 1 && (
              <button
                onClick={switchCamera}
                className="bg-black/60 p-1.5 rounded-full touch-target"
                title="Switch camera"
              >
                <RefreshCw className="w-3.5 h-3.5 text-white" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bottom bar with manual input toggle */}
      <div className="bg-gray-900 px-3 py-2 flex items-center justify-between">
        <button
          onClick={() => setShowManualInput(!showManualInput)}
          className="flex items-center gap-1.5 text-gray-300 text-xs touch-target"
        >
          <Keyboard className="w-4 h-4" />
          <span>Type barcode manually</span>
        </button>
        {isScanning && (
          <div className="flex items-center gap-1 text-green-400">
            <Camera className="w-3.5 h-3.5" />
            <span className="text-[10px]">Camera active</span>
          </div>
        )}
      </div>

      {/* Manual input field */}
      {showManualInput && (
        <div className="bg-gray-800 px-3 py-2 flex gap-2 animate-fade-in">
          <input
            type="text"
            value={manualBarcode}
            onChange={e => setManualBarcode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleManualSubmit()}
            placeholder="Enter barcode number"
            className="flex-1 bg-gray-700 text-white px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent"
            autoFocus
          />
          <button
            onClick={handleManualSubmit}
            disabled={!manualBarcode.trim()}
            className="bg-accent text-white px-4 py-2 rounded-lg text-sm font-medium touch-target disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
