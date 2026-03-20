// VinScanner.jsx
// Scans VIN barcode and auto-populates vehicle info via NHTSA API
// Drop this into your DiagFlow components folder

import React, { useState, useRef, useEffect } from 'react';

const VinScanner = ({ onVehicleData, onClose }) => {
  const [scanning, setScanning] = useState(false);
  const [manualVin, setManualVin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [decodedData, setDecodedData] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setError('');
    setScanning(true);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment', // Use back camera
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      
      // Start scanning loop
      requestAnimationFrame(scanFrame);
    } catch (err) {
      setError('Camera access denied. Please allow camera permissions or enter VIN manually.');
      setScanning(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  const scanFrame = async () => {
    if (!scanning || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      // Check if BarcodeDetector is available (Chrome, Edge, Android)
      if ('BarcodeDetector' in window) {
        try {
          const barcodeDetector = new BarcodeDetector({ 
            formats: ['code_39', 'code_128', 'data_matrix', 'qr_code'] 
          });
          const barcodes = await barcodeDetector.detect(canvas);
          
          for (const barcode of barcodes) {
            const value = barcode.rawValue.replace(/\s/g, '').toUpperCase();
            // VIN is always 17 alphanumeric characters (no I, O, Q)
            if (/^[A-HJ-NPR-Z0-9]{17}$/.test(value)) {
              stopCamera();
              await decodeVin(value);
              return;
            }
          }
        } catch (err) {
          console.log('Barcode detection error:', err);
        }
      }
    }

    // Continue scanning
    if (scanning) {
      requestAnimationFrame(scanFrame);
    }
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
      
      // Parse NHTSA response
      const results = data.Results;
      const getValue = (variableId) => {
        const item = results.find(r => r.VariableId === variableId);
        return item?.Value || '';
      };

      // Extract vehicle data - essential fields only
      const vehicleData = {
        vin: vin,
        year: getValue(29), // Model Year
        make: getValue(26), // Make
        model: getValue(28), // Model
        engine: buildEngineString(results),
        engineDisplacement: getValue(13), // Displacement (L)
        engineCylinders: getValue(9), // Engine Number of Cylinders
        fuelType: getValue(24), // Fuel Type - Primary
        transmission: getValue(37), // Transmission Style
        errorCode: getValue(143), // Error Code (0 = no errors)
        errorText: getValue(191), // Error Text
      };

      // Check for decode errors
      if (vehicleData.errorCode && vehicleData.errorCode !== '0') {
        setError(`VIN decode warning: ${vehicleData.errorText || 'Some fields may be incomplete'}`);
      }

      setDecodedData(vehicleData);
      setLoading(false);

    } catch (err) {
      setError('Failed to decode VIN. Please check the VIN and try again.');
      setLoading(false);
    }
  };

  const buildEngineString = (results) => {
    const getValue = (variableId) => {
      const item = results.find(r => r.VariableId === variableId);
      return item?.Value || '';
    };

    const displacement = getValue(13); // Displacement (L)
    const cylinders = getValue(9); // Cylinders
    const engineModel = getValue(18); // Engine Model
    const fuelType = getValue(24); // Fuel Type

    let engineStr = '';
    
    if (displacement) {
      engineStr += `${displacement}L`;
    }
    if (cylinders) {
      engineStr += engineStr ? ` ${cylinders}-cyl` : `${cylinders}-cyl`;
    }
    if (engineModel) {
      engineStr += engineStr ? ` ${engineModel}` : engineModel;
    }
    if (fuelType && fuelType !== 'Gasoline') {
      engineStr += engineStr ? ` (${fuelType})` : fuelType;
    }

    return engineStr || 'Not specified';
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    const cleanVin = manualVin.replace(/\s/g, '').toUpperCase();
    
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(cleanVin)) {
      setError('Invalid VIN. Must be 17 characters (letters and numbers, no I, O, or Q).');
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

  // Check for BarcodeDetector support
  const hasBarcodeSupport = 'BarcodeDetector' in window;

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
              <div style={styles.scanLine}></div>
            </div>
            <canvas ref={canvasRef} style={styles.hiddenCanvas} />
            <p style={styles.scanText}>Position barcode in frame</p>
            <button onClick={stopCamera} style={styles.cancelScanBtn}>
              Cancel Scan
            </button>
          </div>
        )}

        {/* Main Content (when not scanning) */}
        {!scanning && !decodedData && (
          <div style={styles.content}>
            {/* Scan Button */}
            {hasBarcodeSupport ? (
              <button onClick={startCamera} style={styles.scanBtn}>
                📷 Scan VIN Barcode
              </button>
            ) : (
              <div style={styles.noSupportMsg}>
                <p>⚠️ Barcode scanning not supported in this browser.</p>
                <p style={{ fontSize: '14px', marginTop: '8px' }}>
                  Use Chrome on Android or enter VIN manually below.
                </p>
              </div>
            )}

            <div style={styles.divider}>
              <span style={styles.dividerText}>or enter manually</span>
            </div>

            {/* Manual Entry */}
            <form onSubmit={handleManualSubmit} style={styles.form}>
              <input
                type="text"
                value={manualVin}
                onChange={(e) => setManualVin(e.target.value.toUpperCase())}
                placeholder="Enter 17-character VIN"
                maxLength={17}
                style={styles.input}
              />
              <button 
                type="submit" 
                style={styles.decodeBtn}
                disabled={loading}
              >
                {loading ? 'Decoding...' : 'Decode VIN'}
              </button>
            </form>

            {/* Error Message */}
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
            <p>Decoding VIN...</p>
          </div>
        )}

        {/* Decoded Results */}
        {decodedData && !loading && (
          <div style={styles.results}>
            <h3 style={styles.resultsTitle}>✅ Vehicle Found</h3>
            
            <div style={styles.vehicleCard}>
              <div style={styles.vehicleHeader}>
                <span style={styles.yearMakeModel}>
                  {decodedData.year} {decodedData.make} {decodedData.model}
                </span>
              </div>
              
              <div style={styles.vinDisplay}>
                VIN: <strong>{decodedData.vin}</strong>
              </div>

              <div style={styles.detailsGrid}>
                <DetailRow label="Engine" value={decodedData.engine} />
                <DetailRow label="Fuel Type" value={decodedData.fuelType} />
                <DetailRow label="Transmission" value={decodedData.transmission} />
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
              <button 
                onClick={() => { setDecodedData(null); setManualVin(''); }}
                style={styles.tryAgainBtn}
              >
                ↺ Scan Another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Helper component for detail rows
const DetailRow = ({ label, value }) => {
  if (!value) return null;
  return (
    <div style={styles.detailRow}>
      <span style={styles.detailLabel}>{label}:</span>
      <span style={styles.detailValue}>{value}</span>
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
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '20px',
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '500px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px',
    borderBottom: '1px solid #eee',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    color: '#1e3a5f',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    color: '#666',
    padding: '4px 8px',
  },
  content: {
    padding: '24px',
  },
  scanBtn: {
    width: '100%',
    padding: '16px',
    fontSize: '18px',
    fontWeight: '600',
    backgroundColor: '#1e3a5f',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
  },
  noSupportMsg: {
    textAlign: 'center',
    padding: '20px',
    backgroundColor: '#fff3cd',
    borderRadius: '10px',
    color: '#856404',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    margin: '24px 0',
  },
  dividerText: {
    flex: 1,
    textAlign: 'center',
    color: '#999',
    fontSize: '14px',
    position: 'relative',
    background: 'white',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  input: {
    padding: '14px 16px',
    fontSize: '18px',
    border: '2px solid #ddd',
    borderRadius: '10px',
    fontFamily: 'monospace',
    letterSpacing: '2px',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  decodeBtn: {
    padding: '14px',
    fontSize: '16px',
    fontWeight: '600',
    backgroundColor: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
  },
  error: {
    marginTop: '16px',
    padding: '12px 16px',
    backgroundColor: '#f8d7da',
    color: '#721c24',
    borderRadius: '8px',
    fontSize: '14px',
  },
  cameraContainer: {
    position: 'relative',
    backgroundColor: '#000',
  },
  video: {
    width: '100%',
    display: 'block',
  },
  hiddenCanvas: {
    display: 'none',
  },
  scanOverlay: {
    position: 'absolute',
    top: '50%',
    left: '10%',
    right: '10%',
    height: '80px',
    transform: 'translateY(-50%)',
    border: '2px solid #00ff00',
    borderRadius: '8px',
  },
  scanLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '2px',
    backgroundColor: '#00ff00',
    animation: 'scan 2s linear infinite',
  },
  scanText: {
    textAlign: 'center',
    color: 'white',
    padding: '12px',
    margin: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  cancelScanBtn: {
    width: '100%',
    padding: '14px',
    fontSize: '16px',
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    cursor: 'pointer',
  },
  loadingContainer: {
    padding: '40px',
    textAlign: 'center',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f3f3',
    borderTop: '4px solid #1e3a5f',
    borderRadius: '50%',
    margin: '0 auto 16px',
    animation: 'spin 1s linear infinite',
  },
  results: {
    padding: '24px',
  },
  resultsTitle: {
    margin: '0 0 16px 0',
    color: '#28a745',
    fontSize: '18px',
  },
  vehicleCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: '12px',
    padding: '20px',
    border: '2px solid #1e3a5f',
  },
  vehicleHeader: {
    marginBottom: '12px',
  },
  yearMakeModel: {
    fontSize: '22px',
    fontWeight: 'bold',
    color: '#1e3a5f',
  },
  trim: {
    display: 'inline-block',
    marginLeft: '8px',
    padding: '2px 8px',
    backgroundColor: '#1e3a5f',
    color: 'white',
    borderRadius: '4px',
    fontSize: '12px',
  },
  vinDisplay: {
    fontFamily: 'monospace',
    fontSize: '14px',
    color: '#666',
    marginBottom: '16px',
    padding: '8px',
    backgroundColor: 'white',
    borderRadius: '6px',
  },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
  },
  detailRow: {
    fontSize: '14px',
  },
  detailLabel: {
    color: '#666',
  },
  detailValue: {
    color: '#333',
    fontWeight: '500',
    marginLeft: '4px',
  },
  warningBox: {
    marginTop: '16px',
    padding: '12px',
    backgroundColor: '#fff3cd',
    color: '#856404',
    borderRadius: '8px',
    fontSize: '14px',
  },
  actionButtons: {
    display: 'flex',
    gap: '12px',
    marginTop: '20px',
  },
  useDataBtn: {
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
  tryAgainBtn: {
    flex: 1,
    padding: '14px',
    fontSize: '16px',
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
  },
};

// Add CSS animation for scan line (add this to your global CSS or styled-components)
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes scan {
    0% { top: 0; }
    50% { top: calc(100% - 2px); }
    100% { top: 0; }
  }
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
document.head.appendChild(styleSheet);

export default VinScanner;


// ===========================================
// USAGE EXAMPLE - How to integrate with your vehicle info form
// ===========================================

/*
import React, { useState } from 'react';
import VinScanner from './VinScanner';

const VehicleInfoForm = () => {
  const [showScanner, setShowScanner] = useState(false);
  const [vehicleInfo, setVehicleInfo] = useState({
    vin: '',
    year: '',
    make: '',
    model: '',
    engine: '',
    mileage: '',
  });

  const handleVehicleData = (data) => {
    setVehicleInfo(prev => ({
      ...prev,
      vin: data.vin,
      year: data.year,
      make: data.make,
      model: data.model,
      engine: data.engine,
    }));
    setShowScanner(false);
  };

  return (
    <div>
      <h2>Vehicle Information</h2>
      
      <button onClick={() => setShowScanner(true)}>
        📷 Scan VIN
      </button>

      {showScanner && (
        <VinScanner
          onVehicleData={handleVehicleData}
          onClose={() => setShowScanner(false)}
        />
      )}

      <form>
        <input value={vehicleInfo.vin} placeholder="VIN" readOnly />
        <input value={vehicleInfo.year} placeholder="Year" readOnly />
        <input value={vehicleInfo.make} placeholder="Make" readOnly />
        <input value={vehicleInfo.model} placeholder="Model" readOnly />
        <input value={vehicleInfo.engine} placeholder="Engine" readOnly />
        <input 
          value={vehicleInfo.mileage} 
          onChange={(e) => setVehicleInfo(prev => ({...prev, mileage: e.target.value}))}
          placeholder="Mileage" 
        />
      </form>
    </div>
  );
};
*/
