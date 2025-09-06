import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import Swal from 'sweetalert2';
import imageCompression from 'browser-image-compression';

// --- Configuración de Íconos y Colores ---
const categoryColors = {
    'Emergencia': '#d9534f',
    'Ayuda': '#5cb85c',
    'Calle en mal estado': '#f0ad4e',
    'Servicio público': '#5bc0de',
    'Otro': '#777777',
    'Accidente de Tráfico': '#b30000',
    'Donación de Sangre': '#ff4f81',
    'Fallo Eléctrico': '#ffd700',
    'Fuga de Agua': '#4682b4',
    'Mascota Perdida/Encontrada': '#9370db',
    'Aviso Comunitario': '#337ab7',
    'Actividad Social/Cultural': '#8a2be2'
};

const getColoredIcon = (color) => {
    const markerHtmlStyles = `
        background-color: ${color};
        width: 2rem;
        height: 2rem;
        display: block;
        left: -1rem;
        top: -1rem;
        position: relative;
        border-radius: 2rem 2rem 0;
        transform: rotate(45deg);
        border: 1px solid #FFFFFF;
        box-shadow: 0 0 5px rgba(0,0,0,0.5);`;
    return L.divIcon({
      className: "my-custom-pin",
      iconAnchor: [0, 24],
      popupAnchor: [0, -36],
      html: `<span style="${markerHtmlStyles}" />`
    });
};

const userLocationIcon = getColoredIcon('#4285F4');

// --- Componente auxiliar para centrar el mapa ---
function ChangeView({ center, zoom }) {
    const map = useMap();
    map.flyTo(center, zoom);
    return null;
}

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const CATEGORIES = [
    'Emergencia', 'Ayuda', 'Calle en mal estado', 'Servicio público',
    'Donación de Sangre', 'Aviso Comunitario', 'Actividad Social/Cultural',
    'Mascota Perdida/Encontrada', 'Accidente de Tráfico', 'Fallo Eléctrico',
    'Fuga de Agua', 'Otro'
];

const RELEVANCE_ORDER = {
    'Emergencia': 1,
    'Accidente de Tráfico': 2,
    'Donación de Sangre': 3,
    'Ayuda': 4
};

function App() {
  const [reports, setReports] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [userMunicipality, setUserMunicipality] = useState('');
  const [center, setCenter] = useState([14.6407, -90.5132]);
  const [isLocating, setIsLocating] = useState(true);

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [isPanelOpen, setIsPanelOpen] = useState(window.innerWidth > 768);
  
  const [filterType, setFilterType] = useState('all');
  const [filterCategory, setFilterCategory] = useState('Todas');

  const [newReportDesc, setNewReportDesc] = useState('');
  const [newReportCategory, setNewReportCategory] = useState('Otro');
  const [newReportImage, setNewReportImage] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation([latitude, longitude]);
        setCenter([latitude, longitude]);
        setIsLocating(false);
        try {
            const response = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&countrycodes=gt&accept-language=es`);
            const address = response.data.address;
            setUserMunicipality(address.city || address.town || address.state_district || address.county || address.state);
        } catch (e) { console.error("Error obteniendo municipio", e); }
      },
      () => { 
        console.warn("No se pudo obtener la ubicación.");
        setIsLocating(false);
      }
    );
  }, []);

  useEffect(() => {
    axios.get(`${API_URL}/reports`)
      .then(res => setReports(res.data))
      .catch(err => console.error("Error cargando reportes:", err));

    const socket = io(API_URL);
    socket.on('new_report', (newReport) => setReports(prev => [newReport, ...prev]));
    return () => socket.disconnect();
  }, []);

  const panelContent = useMemo(() => {
    let filteredReports = [...reports];
    if (filterType === 'nearby' && userLocation) {
        filteredReports = reports.filter(report => L.latLng(userLocation).distanceTo([report.location.coordinates[1], report.location.coordinates[0]]) < 5000);
    } else if (filterType === 'municipality' && userMunicipality) {
        filteredReports = reports.filter(report => report.municipality === userMunicipality);
    }
    if (filterCategory !== 'Todas') {
        filteredReports = filteredReports.filter(report => report.category === filterCategory);
    }
    return filteredReports.sort((a, b) => {
        const relevanceA = RELEVANCE_ORDER[a.category] || 99;
        const relevanceB = RELEVANCE_ORDER[b.category] || 99;
        if (relevanceA !== relevanceB) return relevanceA - relevanceB;
        if (userLocation) {
            const distA = L.latLng(userLocation).distanceTo([a.location.coordinates[1], a.location.coordinates[0]]);
            const distB = L.latLng(userLocation).distanceTo([b.location.coordinates[1], b.location.coordinates[0]]);
            return distA - distB;
        }
        return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [reports, filterType, filterCategory, userLocation, userMunicipality]);

  const handleSubmitReport = async () => {
    if (!userLocation || !newReportDesc) {
        Swal.fire({ icon: 'warning', title: 'Faltan datos', text: 'Se requiere tu ubicación y una descripción.' });
        return;
    }
    setIsSubmitting(true);
    const formData = new FormData();
    formData.append('description', newReportDesc);
    formData.append('category', newReportCategory);
    formData.append('coordinates', JSON.stringify(userLocation));

    if (newReportImage) {
        try {
            const compressedFile = await imageCompression(newReportImage, { maxSizeMB: 1, maxWidthOrHeight: 1920 });
            formData.append('image', compressedFile, compressedFile.name);
        } catch (error) {
            console.error("Error al comprimir la imagen:", error);
            Swal.fire({ icon: 'error', title: 'Error de imagen', text: 'No se pudo procesar la imagen.' });
            setIsSubmitting(false);
            return;
        }
    }

    try {
        await axios.post(`${API_URL}/reports`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        setShowAddModal(false);
        setNewReportDesc(''); setNewReportCategory('Otro'); setNewReportImage(null);
        Swal.fire({ icon: 'success', title: '¡Reporte Enviado!', timer: 2000, showConfirmButton: false });
    } catch(err) {
        console.error("Error al crear reporte:", err);
        Swal.fire({ icon: 'error', title: 'Error', text: 'Hubo un error al crear el reporte.' });
    } finally {
        setIsSubmitting(false);
    }
  };
  
  const handleRecenter = () => { if (userLocation) setCenter(userLocation); };

  return (
    <>
      <style>{`
        body, html { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
        .map-container-wrapper { display: flex; height: 100vh; width: 100vw; overflow: hidden; position: relative; }
        .side-panel { width: 350px; min-width: 350px; height: 100%; overflow-y: auto; box-shadow: 2px 0 5px rgba(0,0,0,0.1); padding: 15px; background: white; transition: transform 0.3s ease-in-out; box-sizing: border-box; }
        .side-panel.closed { transform: translateX(-100%); min-width: 0; width: 0; padding: 0 15px; overflow: hidden; }
        .panel-controls button, .panel-controls select { width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid #ccc; border-radius: 5px; background: #f0f0f0; cursor: pointer; }
        .report-item { display: flex; align-items: center; margin-bottom: 10px; padding: 10px; border: 1px solid #eee; border-radius: 8px; cursor: pointer; }
        .report-item-icon { width: 12px; height: 12px; border-radius: 50%; margin-right: 12px; flex-shrink: 0; }
        .map-wrapper { flex-grow: 1; height: 100%; position: relative; }
        .panel-toggle-button { position: absolute; top: 70px; left: 10px; z-index: 1000; background: white; border: 1px solid #ccc; border-radius: 4px; padding: 5px; cursor: pointer; font-size: 24px; width: 40px; height: 40px; line-height: 30px; }
        .floating-buttons { position: absolute; bottom: 20px; right: 20px; z-index: 401; display: flex; flex-direction: column; gap: 10px; align-items: center; }
        .floating-button { width: 56px; height: 56px; line-height: 56px; text-align: center; color: white; border: none; border-radius: 50%; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.25); display: grid; place-items: center; }
        .floating-button:disabled { background-color: #9E9E9E; cursor: not-allowed; }
        .recenter-button { background-color: white; color: #555; font-size: 24px; width: 48px; height: 48px; }
        .add-report-button { background-color: #4285f4; font-size: 32px; }
        .detail-modal-backdrop, .modal-backdrop { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); z-index: 2000; }
        .detail-modal-content, .modal-content { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 0; border-radius: 12px; width: 90%; max-width: 500px; z-index: 2002; overflow: hidden; }
        .detail-modal-image { width: 100%; height: 250px; object-fit: cover; background-color: #eee; }
        .detail-modal-no-image { width: 100%; height: 250px; background-color: #f0f0f0; display: flex; align-items: center; justify-content: center; color: #888; font-style: italic; font-size: 1.2em; } /* Estilo para placeholder */
        .detail-modal-text { padding: 25px; }
        .modal-content { padding: 25px; }
        .modal-content textarea, .modal-content select, .modal-content input, .modal-content button { width: 100%; padding: 12px; margin-top: 12px; border-radius: 8px; border: 1px solid #ccc; font-size: 16px; box-sizing: border-box; }
        .detail-modal-close-button { position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 30px; height: 30px; font-size: 20px; line-height: 30px; text-align: center; cursor: pointer; z-index: 1; }
        
        .swal2-container { z-index: 3000 !important; }

        .panel-overlay { display: none; }
        .panel-internal-close-button { display: none; }

        @media (max-width: 768px) {
            .side-panel { position: absolute; top: 0; left: 0; z-index: 1001; width: 85vw; max-width: 350px; }
            .side-panel.closed { transform: translateX(-100%); }
            .map-wrapper { width: 100vw; }
            .panel-overlay { display: block; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; }
            .panel-internal-close-button { display: block; position: absolute; top: 5px; right: 5px; background: none; border: none; font-size: 28px; cursor: pointer; color: #888; }
            /* Ocultar el botón externo cuando el panel está abierto en móvil */
            .panel-toggle-button { display: ${isPanelOpen ? 'none' : 'block'}; }
        }
      `}</style>
      
      <div className="map-container-wrapper">
        {isMobile && isPanelOpen && <div className="panel-overlay" onClick={() => setIsPanelOpen(false)}></div>}

        <div className={`side-panel ${isPanelOpen ? 'open' : 'closed'}`}>
            <button className="panel-internal-close-button" onClick={() => setIsPanelOpen(false)}>&times;</button>
            <h3>Eventos</h3>
            <div className="panel-controls">
                <button onClick={() => setFilterType('all')}>Ver Todos</button>
                <button onClick={() => setFilterType('nearby')} disabled={isLocating || !userLocation}>Ver cerca de mí</button>
                <button onClick={() => setFilterType('municipality')} disabled={!userMunicipality}>Ver en mi municipio</button>
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                    <option value="Todas">Todas las categorías</option>
                    {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
            </div>
            <hr/>
            {panelContent.map(report => (
                <div key={report._id} className="report-item" onClick={() => setSelectedReport(report)}>
                    <div className="report-item-icon" style={{ backgroundColor: categoryColors[report.category] || 'grey' }}></div>
                    <div className="report-item-content">
                        <b>{report.category}</b>
                        <p>{report.description.substring(0, 80)}...</p>
                        <small>{new Date(report.createdAt).toLocaleString('es-GT')}</small>
                    </div>
                </div>
            ))}
        </div>

        <div className="map-wrapper">
            {!isPanelOpen && <button className="panel-toggle-button" onClick={() => setIsPanelOpen(true)}>›</button>}
            <MapContainer center={center} zoom={15} maxZoom={20} style={{ height: "100%", width: "100%" }}>
                <ChangeView center={center} zoom={15} />
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
                
                {userLocation && <Marker position={userLocation} icon={userLocationIcon}><Popup>Ubicación actual</Popup></Marker>}
                {reports.map(report => (
                    <Marker key={report._id} 
                            position={[report.location.coordinates[1], report.location.coordinates[0]]} 
                            icon={getColoredIcon(categoryColors[report.category] || 'grey')}>
                        <Popup><b>{report.category}</b><br/>{report.description}</Popup>
                    </Marker>
                ))}
            </MapContainer>
            
            <div className="floating-buttons">
                {userLocation && <button className="floating-button recenter-button" title="Centrar" onClick={handleRecenter}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V2"/><path d="M12 22v-6"/><path d="M22 12h-6"/><path d="M8 12H2"/><path d="m18 6-4-4-4 4"/><path d="m6 18 4 4 4-4"/></svg>
                </button>}
                <button className="floating-button add-report-button" title={isLocating ? "Obteniendo ubicación..." : "Agregar reporte"} onClick={() => setShowAddModal(true)} disabled={isLocating}>+</button>
            </div>

            {selectedReport && (
                <>
                    <div className="detail-modal-backdrop" onClick={() => setSelectedReport(null)}></div>
                    <div className="detail-modal-content">
                        <button className="detail-modal-close-button" onClick={() => setSelectedReport(null)}>&times;</button>
                        {/* --- CAMBIO AQUÍ: Renderizado condicional de la imagen --- */}
                        {selectedReport.imageUrl ? 
                            <img src={selectedReport.imageUrl} alt="Imagen del reporte" className="detail-modal-image"/> 
                            : 
                            <div className="detail-modal-no-image"><span>No hay imagen disponible</span></div>
                        }
                        <div className="detail-modal-text">
                            <h3>{selectedReport.category}</h3>
                            <p>{selectedReport.description}</p>
                            <hr/>
                            <small>Municipio: {selectedReport.municipality || 'No especificado'}</small><br/>
                            <small>Fecha: {new Date(selectedReport.createdAt).toLocaleString('es-GT')}</small>
                        </div>
                    </div>
                </>
            )}

            {showAddModal && (
                <>
                    <div className="modal-backdrop" onClick={() => !isSubmitting && setShowAddModal(false)}></div>
                    <div className="modal-content">
                        <h3>Crear Nuevo Reporte</h3>
                        <textarea rows="3" placeholder="Descripción..." value={newReportDesc} onChange={e => setNewReportDesc(e.target.value)} />
                        <select value={newReportCategory} onChange={e => setNewReportCategory(e.target.value)}>
                            {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                        <label htmlFor="image-upload" style={{display: 'block', marginTop: '10px', fontSize: '14px'}}>Subir imagen (opcional):</label>
                        <input type="file" id="image-upload" accept="image/*" onChange={(e) => setNewReportImage(e.target.files[0])} />
                        <button onClick={handleSubmitReport} disabled={isSubmitting} style={{background: '#4285f4', color: 'white'}}>{isSubmitting ? 'Enviando...' : 'Enviar Reporte'}</button>
                        <button onClick={() => setShowAddModal(false)} disabled={isSubmitting} style={{background: '#ccc'}}>Cancelar</button>
                    </div>
                </>
            )}
        </div>
      </div>
    </>
  );
}

export default App;