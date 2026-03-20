// VinScanner.jsx
// Enhanced VIN Scanner with Barcode + Google Cloud Vision OCR
// Priority: Barcode first, OCR fallback
// Auto-populates: VIN, Year, Make, Model, Engine via NHTSA API

import React, { useState, useRef, useEffect, useCallback } from 'react';

// ⚠️ IMPORTANT: Replace with your Google Cloud Vision API key
// Get one at: https://console.cloud.google.com/apis/credentials
// Enable "Cloud Vision API" in your Google Cloud project
const GOOGLE_CLOUD_VISION_API_KEY = 'AIzaSyA2YN_TX7nuGDfE5hVQPz9r21ItlRAlUuM';

const VinScanner = ({ onVehicleData, onClose }) => {
  const [scanning, setScanning] = useState(false);
  const [scanMode, setScanMode] = useState('barcode'); // 'barcode' | 'ocr' | 'processing'
  const [manualVin, setManualVin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [decodedData, setDecodedData] = useState(null);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const barcodeTimeoutRef = useRef(null);
  const scanningRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      if (barcodeTimeoutRef.current) {
        clearTimeout(barcodeTimeoutRef.current);
      }
    };
  }, []);

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (barcodeTimeoutRef.current) {
      clearTimeout(barcodeTimeoutRef.current);
    }
    setScanning(false);
  }, []);

  const startCamera = async () => {
    setError('');
    setScanning(true);
    setScanMode('barcode');
    setStatusMessage('Looking for barcode...');
    scanningRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Start barcode scanning
      if ('BarcodeDetector' in window) {
        scanForBarcode();
        
        // Set timeout - if no barcode found in 5 seconds, switch to OCR mode
        barcodeTimeoutRef.current = setTimeout(() => {
          if (scanningRef.current && scanMode === 'barcode') {
            setStatusMessage('No barcode found. Tap "Capture" to use OCR.');
            setScanMode('ocr');
          }
        }, 5000);
      } else {
        // No barcode support, go straight to OCR mode
        setStatusMessage('Tap "Capture" to photograph the VIN');
        setScanMode('ocr');
      }

    } catch (err) {
      setError('Camera access denied. Please allow camera permissions or enter VIN manually.');
      setScanning(false);
    }
  };

  const scanForBarcode = async () => {
    if (!scanningRef.current || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      try {
        const barcodeDetector = new BarcodeDetector({
          formats: ['code_39', 'code_128', 'data_matrix', 'qr_code']
        });
        const barcodes = await barcodeDetector.detect(canvas);

        for (const barcode of barcodes) {
          const value = barcode.rawValue.replace(/\s/g, '').toUpperCase();
          // VIN is always 17 alphanumeric characters (no I, O, Q)
          if (isValidVin(value)) {
            // Found it!
            if (barcodeTimeoutRef.current) {
              clearTimeout(barcodeTimeoutRef.current);
            }
            stopCamera();
            setStatusMessage('Barcode found! Decoding...');
            await decodeVin(value);
            return;
          }
        }
      } catch (err) {
        console.log('Barcode scan error:', err);
      }
    }

    // Continue scanning if still in barcode mode
    if (scanningRef.current && scanMode === 'barcode') {
      requestAnimationFrame(scanForBarcode);
    }
  };

  const captureForOCR = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setScanMode('processing');
    setStatusMessage('Processing image...');

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    // Get base64 image
    const imageData = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];

    stopCamera();

    // Send to Google Cloud Vision
    await performOCR(imageData);
  };

  const performOCR = async (base64Image) => {
    setLoading(true);
    setStatusMessage('Reading VIN with OCR...');

    try {
      const response = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_CLOUD_VISION_API_KEY}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [{
              image: { content: base64Image },
              features: [{ type: 'TEXT_DETECTION', maxResults: 10 }]
            }]
          })
        }
      );

      if (!response.ok) {
        throw new Error('OCR request failed');
      }

      const data = await response.json();
      
      // Extract text from response
      const textAnnotations = data.responses?.[0]?.textAnnotations;
      if (!textAnnotations || textAnnotations.length === 0) {
        setError('Could not read any text. Try again with better lighting or enter VIN manually.');
        setLoading(false);
        return;
      }

      // Search for VIN pattern in detected text
      const fullText = textAnnotations[0].description;
      const vin = extractVinFromText(fullText);

      if (vin) {
        setStatusMessage('VIN found! Decoding...');
        await decodeVin(vin);
      } else {
        setError('Could not find a valid VIN in the image. Please try again or enter manually.');
        setLoading(false);
      }

    } catch (err) {
      console.error('OCR error:', err);
      setError('OCR failed. Please check your API key or enter VIN manually.');
      setLoading(false);
    }
  };

  const extractVinFromText = (text) => {
    // Clean up the text
    const cleanText = text.toUpperCase().replace(/[^A-HJ-NPR-Z0-9\s]/g, '');
    
    // Split into words/chunks
    const chunks = cleanText.split(/\s+/);
    
    // Look for valid VIN pattern
    for (const chunk of chunks) {
      const cleaned = chunk.replace(/\s/g, '');
      if (isValidVin(cleaned)) {
        return cleaned;
      }
    }

    // Try to find 17-char sequence in the entire text (no spaces)
    const noSpaces = cleanText.replace(/\s/g, '');
    for (let i = 0; i <= noSpaces.length - 17; i++) {
      const potential = noSpaces.substring(i, i + 17);
      if (isValidVin(potential)) {
        return potential;
      }
    }

    return null;
  };

  const isValidVin = (vin) => {
    // VIN must be exactly 17 characters, alphanumeric, no I, O, Q
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
      return false;
    }
    
    // Optional: Validate check digit (position 9)
    // This catches most typos/misreads
    return validateVinCheckDigit(vin);
  };

  const validateVinCheckDigit = (vin) => {
    const transliteration = {
      'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'H': 8,
      'J': 1, 'K': 2, 'L': 3, 'M': 4, 'N': 5, 'P': 7, 'R': 9,
      'S': 2, 'T': 3, 'U': 4, 'V': 5, 'W': 6, 'X': 7, 'Y': 8, 'Z': 9,
      '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9
    };
    const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
    
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      const char = vin[i];
      const value = transliteration[char];
      if (value === undefined) return false;
      sum += value * weights[i];
    }
    
    const remainder = sum % 11;
    const checkDigit = remainder === 10 ? 'X' : remainder.toString();
    
    return vin[8] === checkDigit;
  };

  const decodeVin = async (vin) => {
    setLoading(true);
    setError('');
    setManualVin(vin);

    try {
      const response = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`
      );

      if (!response.ok) {
        throw new Error('Failed to decode VIN');
      }

      const data = await response.json();
      const results = data.Results;
      
      const getValue = (variableId) => {
        const item = results.find(r => r.VariableId === variableId);
        return item?.Value || '';
      };

      // Build engine string
      const displacement = getValue(13);
      const cylinders = getValue(9);
      const engineModel = getValue(18);
      const fuelType = getValue(24);

      let engineStr = '';
      if (displacement) engineStr += `${displacement}L`;
      if (cylinders) engineStr += engineStr ? ` ${cylinders}-cyl` : `${cylinders}-cyl`;
      if (engineModel) engineStr += engineStr ? ` ${engineModel}` : engineModel;
      if (fuelType && fuelType !== 'Gasoline') engineStr += engineStr ? ` (${fuelType})` : fuelType;

      const vehicleData = {
        vin: vin,
        year: getValue(29),
        make: getValue(26),
        model: getValue(28),
        engine: engineStr || 'Not specified',
        engineDisplacement: getValue(13),
        engineCylinders: getValue(9),
        fuelType: getValue(24),
        transmission: getValue(37),
      };

      // Check for decode errors
      const errorCode = getValue(143);
      if (errorCode && errorCode !== '0') {
        setError(`Note: ${getValue(191) || 'Some fields may be incomplete'}`);
      }

      setDecodedData(vehicleData);
      setLoading(false);
      setStatusMessage('');

    } catch (err) {
      setError('Failed to decode VIN. Please check the VIN and try again.');
      setLoading(false);
    }
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    const cleanVin = manualVin.replace(/\s/g, '').toUpperCase();

    if (cleanVin.length !== 17) {
      setError('VIN must be exactly 17 characters.');
      return;
    }

    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(cleanVin)) {
      setError('Invalid VIN. Letters I, O, and Q are not allowed.');
      return;
    }

    decodeVin(cleanVin);
  };

  const handleUseData = () => {
    if (decodedData && onVehicleData) {
      onVehicleData(decodedData);
    }
    if (onClose) {
      onClose();
    }
  };

  const handleCancel = () => {
    stopCamera();
    if (onClose) {
      onClose();
    }
  };

  const resetScanner = () => {
    setDecodedData(null);
    setManualVin('');
    setError('');
    setStatusMessage('');
    setScanMode('barcode');
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>🔍 VIN Scanner</h2>
          <button onClick={handleCancel} style={styles.closeBtn}>✕</button>
        </div>

        {/* Camera View */}
        {scanning && (
          <div style={styles.cameraContainer}>
            <video
              ref={videoRef}
              style={styles.video}
              playsInline
              muted
            />
            <div style={styles.scanOverlay}>
              <div style={styles.scanFrame}>
                <div style={styles.cornerTL}></div>
                <div style={styles.cornerTR}></div>
                <div style={styles.cornerBL}></div>
                <div style={styles.cornerBR}></div>
              </div>
            </div>
            <canvas ref={canvasRef} style={styles.hiddenCanvas} />
            
            <div style={styles.statusBar}>
              <div style={styles.statusIndicator}>
                {scanMode === 'barcode' && <span style={styles.pulsingDot}></span>}
                {statusMessage}
              </div>
            </div>

            <div style={styles.cameraButtons}>
              {scanMode === 'ocr' && (
                <button onClick={captureForOCR} style={styles.captureBtn}>
                  📸 Capture VIN
                </button>
              )}
              <button onClick={stopCamera} style={styles.cancelScanBtn}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Main Content (when not scanning) */}
        {!scanning && !decodedData && !loading && (
          <div style={styles.content}>
            <div style={styles.instructions}>
              <p style={styles.instructionText}>
                <strong>Point camera at VIN label</strong> (driver's door jamb or dashboard)
              </p>
              <p style={styles.subText}>
                Barcode scans automatically. If no barcode, tap Capture for OCR.
              </p>
            </div>

            <button onClick={startCamera} style={styles.scanBtn}>
              📷 Start Scanner
            </button>

            <div style={styles.divider}>
              <span style={styles.dividerText}>or enter manually</span>
            </div>

            <form onSubmit={handleManualSubmit} style={styles.form}>
              <input
                type="text"
                value={manualVin}
                onChange={(e) => setManualVin(e.target.value.toUpperCase())}
                placeholder="Enter 17-character VIN"
                maxLength={17}
                style={styles.input}
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
              />
              <div style={styles.charCount}>
                {manualVin.length}/17
              </div>
              <button
                type="submit"
                style={{
                  ...styles.decodeBtn,
                  opacity: manualVin.length === 17 ? 1 : 0.5
                }}
                disabled={manualVin.length !== 17}
              >
                Decode VIN
              </button>
            </form>

            {error && (
              <div style={styles.error}>
                ⚠️ {error}
              </div>
            )}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div style={styles.loadingContainer}>
            <div style={styles.spinner}></div>
            <p style={styles.loadingText}>{statusMessage || 'Decoding VIN...'}</p>
          </div>
        )}

        {/* Decoded Results */}
        {decodedData && !loading && (
          <div style={styles.results}>
            <div style={styles.successBanner}>
              ✅ Vehicle Found
            </div>

            <div style={styles.vehicleCard}>
              <div style={styles.yearMakeModel}>
                {decodedData.year} {decodedData.make} {decodedData.model}
              </div>

              <div style={styles.vinDisplay}>
                <span style={styles.vinLabel}>VIN</span>
                <span style={styles.vinValue}>{decodedData.vin}</span>
              </div>

              <div style={styles.detailsGrid}>
                {decodedData.engine && (
                  <div style={styles.detailItem}>
                    <span style={styles.detailIcon}>⚙️</span>
                    <span style={styles.detailText}>{decodedData.engine}</span>
                  </div>
                )}
                {decodedData.fuelType && (
                  <div style={styles.detailItem}>
                    <span style={styles.detailIcon}>⛽</span>
                    <span style={styles.detailText}>{decodedData.fuelType}</span>
                  </div>
                )}
                {decodedData.transmission && (
                  <div style={styles.detailItem}>
                    <span style={styles.detailIcon}>🔄</span>
                    <span style={styles.detailText}>{decodedData.transmission}</span>
                  </div>
                )}
              </div>
            </div>

            {error && (
              <div style={styles.warningBox}>
                ⚠️ {error}
              </div>
            )}

            <div style={styles.actionButtons}>
              <button onClick={handleUseData} style={styles.useDataBtn}>
                ✓ Use This Vehicle
              </button>
              <button onClick={resetScanner} style={styles.tryAgainBtn}>
                ↺ Scan Another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Styles
const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '16px',
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '480px',
    maxHeight: '90vh',
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #eee',
    backgroundColor: '#1e3a5f',
    color: 'white',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '600',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    color: 'white',
    padding: '4px 8px',
    opacity: 0.8,
  },
  content: {
    padding: '24px',
    overflowY: 'auto',
  },
  instructions: {
    textAlign: 'center',
    marginBottom: '20px',
  },
  instructionText: {
    margin: '0 0 8px 0',
    fontSize: '16px',
    color: '#333',
  },
  subText: {
    margin: 0,
    fontSize: '14px',
    color: '#666',
  },
  scanBtn: {
    width: '100%',
    padding: '16px',
    fontSize: '18px',
    fontWeight: '600',
    backgroundColor: '#1e3a5f',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    margin: '24px 0',
    gap: '16px',
  },
  dividerText: {
    color: '#999',
    fontSize: '14px',
    whiteSpace: 'nowrap',
  },
  form: {
    position: 'relative',
  },
  input: {
    width: '100%',
    padding: '16px',
    fontSize: '20px',
    border: '2px solid #ddd',
    borderRadius: '12px',
    fontFamily: 'monospace',
    letterSpacing: '3px',
    textAlign: 'center',
    textTransform: 'uppercase',
    boxSizing: 'border-box',
  },
  charCount: {
    textAlign: 'right',
    fontSize: '12px',
    color: '#999',
    marginTop: '4px',
    marginBottom: '12px',
  },
  decodeBtn: {
    width: '100%',
    padding: '14px',
    fontSize: '16px',
    fontWeight: '600',
    backgroundColor: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
  },
  error: {
    marginTop: '16px',
    padding: '14px 16px',
    backgroundColor: '#f8d7da',
    color: '#721c24',
    borderRadius: '10px',
    fontSize: '14px',
  },
  cameraContainer: {
    position: 'relative',
    backgroundColor: '#000',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  video: {
    width: '100%',
    flex: 1,
    objectFit: 'cover',
  },
  hiddenCanvas: {
    display: 'none',
  },
  scanOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 80,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  scanFrame: {
    width: '85%',
    height: '80px',
    position: 'relative',
  },
  cornerTL: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '24px',
    height: '24px',
    borderTop: '3px solid #00ff00',
    borderLeft: '3px solid #00ff00',
  },
  cornerTR: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '24px',
    height: '24px',
    borderTop: '3px solid #00ff00',
    borderRight: '3px solid #00ff00',
  },
  cornerBL: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: '24px',
    height: '24px',
    borderBottom: '3px solid #00ff00',
    borderLeft: '3px solid #00ff00',
  },
  cornerBR: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: '24px',
    height: '24px',
    borderBottom: '3px solid #00ff00',
    borderRight: '3px solid #00ff00',
  },
  statusBar: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: '12px 16px',
  },
  statusIndicator: {
    color: 'white',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    justifyContent: 'center',
  },
  pulsingDot: {
    width: '10px',
    height: '10px',
    backgroundColor: '#00ff00',
    borderRadius: '50%',
    animation: 'pulse 1s infinite',
  },
  cameraButtons: {
    display: 'flex',
    gap: '12px',
    padding: '12px 16px',
    backgroundColor: '#000',
  },
  captureBtn: {
    flex: 2,
    padding: '14px',
    fontSize: '16px',
    fontWeight: '600',
    backgroundColor: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
  },
  cancelScanBtn: {
    flex: 1,
    padding: '14px',
    fontSize: '16px',
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
  },
  loadingContainer: {
    padding: '60px 24px',
    textAlign: 'center',
  },
  spinner: {
    width: '48px',
    height: '48px',
    border: '4px solid #f3f3f3',
    borderTop: '4px solid #1e3a5f',
    borderRadius: '50%',
    margin: '0 auto 20px',
    animation: 'spin 1s linear infinite',
  },
  loadingText: {
    color: '#666',
    fontSize: '16px',
  },
  results: {
    padding: '24px',
    overflowY: 'auto',
  },
  successBanner: {
    backgroundColor: '#d4edda',
    color: '#155724',
    padding: '12px',
    borderRadius: '10px',
    textAlign: 'center',
    fontWeight: '600',
    fontSize: '16px',
    marginBottom: '20px',
  },
  vehicleCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: '12px',
    padding: '20px',
    border: '2px solid #1e3a5f',
  },
  yearMakeModel: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#1e3a5f',
    marginBottom: '16px',
    textAlign: 'center',
  },
  vinDisplay: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '12px',
    backgroundColor: 'white',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  vinLabel: {
    fontSize: '12px',
    color: '#666',
    fontWeight: '600',
  },
  vinValue: {
    fontFamily: 'monospace',
    fontSize: '14px',
    letterSpacing: '1px',
    color: '#333',
  },
  detailsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  detailItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    backgroundColor: 'white',
    borderRadius: '6px',
  },
  detailIcon: {
    fontSize: '18px',
  },
  detailText: {
    fontSize: '14px',
    color: '#333',
  },
  warningBox: {
    marginTop: '16px',
    padding: '12px 16px',
    backgroundColor: '#fff3cd',
    color: '#856404',
    borderRadius: '10px',
    fontSize: '14px',
  },
  actionButtons: {
    display: 'flex',
    gap: '12px',
    marginTop: '20px',
  },
  useDataBtn: {
    flex: 2,
    padding: '16px',
    fontSize: '16px',
    fontWeight: '600',
    backgroundColor: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
  },
  tryAgainBtn: {
    flex: 1,
    padding: '16px',
    fontSize: '16px',
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
  },
};

// Add CSS animations
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleSheet);
}

export default VinScanner;


// ===========================================
// SETUP INSTRUCTIONS FOR GOOGLE CLOUD VISION
// ===========================================
/*
1. Go to https://console.cloud.google.com/
2. Create a new project (or select existing)
3. Enable the "Cloud Vision API":
   - Go to APIs & Services > Library
   - Search for "Cloud Vision API"
   - Click Enable
4. Create API credentials:
   - Go to APIs & Services > Credentials
   - Click "Create Credentials" > "API Key"
   - Copy the key
5. (Recommended) Restrict the API key:
   - Click on the key to edit
   - Under "API restrictions", select "Restrict key"
   - Choose "Cloud Vision API"
   - Under "Application restrictions", add your domain
6. Replace 'YOUR_API_KEY_HERE' at the top of this file

COST: ~$1.50 per 1,000 images (first 1,000/month free)
*/


// ===========================================
// USAGE EXAMPLE
// ===========================================
/*
import VinScanner from './VinScanner';

const VehicleInfoSection = () => {
  const [showScanner, setShowScanner] = useState(false);
  const [vehicle, setVehicle] = useState({
    vin: '',
    year: '',
    make: '',
    model: '',
    engine: '',
    mileage: ''
  });

  const handleVehicleData = (data) => {
    // This is called when user taps "Use This Vehicle"
    // Data contains: vin, year, make, model, engine, fuelType, transmission
    setVehicle(prev => ({
      ...prev,
      vin: data.vin,
      year: data.year,
      make: data.make,
      model: data.model,
      engine: data.engine
    }));
  };

  return (
    <div>
      <button onClick={() => setShowScanner(true)}>
        📷 Scan VIN
      </button>

      {showScanner && (
        <VinScanner
          onVehicleData={handleVehicleData}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Your form fields - these get auto-populated *//*}
      <input value={vehicle.vin} placeholder="VIN" />
      <input value={vehicle.year} placeholder="Year" />
      <input value={vehicle.make} placeholder="Make" />
      <input value={vehicle.model} placeholder="Model" />
      <input value={vehicle.engine} placeholder="Engine" />
      <input 
        value={vehicle.mileage} 
        onChange={(e) => setVehicle(prev => ({...prev, mileage: e.target.value}))}
        placeholder="Mileage (enter manually)" 
      />
    </div>
  );
};
*/
