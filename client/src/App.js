import React, { useEffect, useState } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// --- Configuración de Íconos y Colores ---
const categoryColors = {
    'Emergencia': '#d9534f',
    'Ayuda': '#5cb85c',
    'Calle en mal estado': '#f0ad4e',
    'Servicio público': '#5bc0de',
    'Otro': '#777777'
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

// --- Componente auxiliar para centrar el mapa suavemente ---
function ChangeView({ center, zoom }) {
    const map = useMap();
    map.flyTo(center, zoom);
    return null;
}

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const CATEGORIES = ['Emergencia', 'Ayuda', 'Calle en mal estado', 'Servicio público', 'Otro'];

function App() {
  const [reports, setReports] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [userMunicipality, setUserMunicipality] = useState('');
  const [center, setCenter] = useState([14.6407, -90.5132]);

  // Estados de Modales y Paneles
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [panelContent, setPanelContent] = useState([]);
  const [panelTitle, setPanelTitle] = useState('Eventos Recientes');

  // Estados del Formulario
  const [newReportDesc, setNewReportDesc] = useState('');
  const [newReportCategory, setNewReportCategory] = useState('Otro');
  const [newReportImage, setNewReportImage] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 1. Obtener ubicación del usuario y su municipio
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const currentLocation = [latitude, longitude];
        setUserLocation(currentLocation);
        setCenter(currentLocation);
        
        try {
            // Se eliminó la cabecera 'User-Agent' que causaba un error en el navegador
            const response = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&countrycodes=gt&accept-language=es`);
            const address = response.data.address;
            const municipality = address.city || address.town || address.state_district || address.county || address.state;
            setUserMunicipality(municipality);
            setPanelTitle(`Eventos en ${municipality}`);
        } catch (e) { console.error("Error obteniendo municipio", e); }
      },
      () => { console.warn("No se pudo obtener la ubicación."); }
    );
  }, []);

  // 2. Cargar reportes y conectar a WebSockets
  useEffect(() => {
    axios.get(`${API_URL}/reports`)
      .then(res => {
        setReports(res.data);
        setPanelContent(res.data);
      })
      .catch(err => console.error("Error cargando reportes:", err));

    const socket = io(API_URL);
    socket.on('new_report', (newReport) => {
      setReports(prev => [newReport, ...prev]);
      setPanelContent(prev => [newReport, ...prev]);
    });
    return () => socket.disconnect();
  }, []);
  
  // 3. Lógica para filtrar eventos
  const showNearbyEvents = () => {
      if(!userLocation) return;
      setPanelTitle('Eventos Cercanos (a 5km)');
      const nearby = reports.filter(report => {
          const reportLoc = L.latLng(report.location.coordinates[1], report.location.coordinates[0]);
          const userLoc = L.latLng(userLocation[0], userLocation[1]);
          return userLoc.distanceTo(reportLoc) < 5000;
      });
      setPanelContent(nearby);
      setIsPanelOpen(true);
  };
  
  const showMunicipalityEvents = () => {
      if(!userMunicipality) return;
      setPanelTitle(`Eventos en ${userMunicipality}`);
      const inMunicipality = reports.filter(report => report.municipality === userMunicipality);
      setPanelContent(inMunicipality);
      setIsPanelOpen(true);
  };

  // 4. Lógica para enviar el formulario
  const handleSubmitReport = async () => {
    if (!userLocation || !newReportDesc) {
        alert("Se requiere ubicación y descripción."); return;
    }
    setIsSubmitting(true);
    const formData = new FormData();
    formData.append('description', newReportDesc);
    formData.append('category', newReportCategory);
    formData.append('coordinates', JSON.stringify(userLocation));
    if (newReportImage) formData.append('image', newReportImage);

    try {
        await axios.post(`${API_URL}/reports`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        setShowAddModal(false);
        setNewReportDesc(''); setNewReportCategory('Otro'); setNewReportImage(null);
    } catch(err) {
        console.error("Error al crear reporte:", err);
        alert("Hubo un error al crear el reporte. Por favor, inténtalo de nuevo.");
    } finally {
        setIsSubmitting(false);
    }
  };
  
  // 5. Función para el botón de recentrar
  const handleRecenter = () => { if (userLocation) setCenter(userLocation); };

  return (
    <>
      <style>{`
        body, html { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
        .map-container-wrapper { display: flex; height: 100vh; }
        .side-panel { width: 350px; min-width: 350px; height: 100%; overflow-y: auto; box-shadow: 2px 0 5px rgba(0,0,0,0.1); padding: 15px; background: white; transition: min-width 0.3s, padding 0.3s; box-sizing: border-box; }
        .side-panel.closed { min-width: 0; width: 0; padding: 15px 0; overflow: hidden; }
        .panel-controls button { width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid #ccc; border-radius: 5px; background: #f0f0f0; cursor: pointer; transition: background-color 0.2s; }
        .panel-controls button:hover { background-color: #e0e0e0; }
        .report-item { display: flex; align-items: center; margin-bottom: 10px; padding: 10px; border: 1px solid #eee; border-radius: 8px; cursor: pointer; transition: background-color 0.2s, box-shadow 0.2s; }
        .report-item:hover { background: #f9f9f9; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .report-item-icon { width: 12px; height: 12px; border-radius: 50%; margin-right: 12px; flex-shrink: 0; }
        .report-item-content b { font-size: 1rem; color: #333; }
        .report-item-content p { font-size: 0.85rem; color: #666; margin: 4px 0 0 0; }
        .report-item-content small { font-size: 0.75rem; color: #999; }
        .map-wrapper { flex-grow: 1; height: 100%; position: relative; }
        .panel-toggle-button { position: absolute; top: 10px; left: 10px; z-index: 1000; background: white; border: 1px solid #ccc; border-radius: 4px; padding: 5px; cursor: pointer; }
        .floating-buttons { position: absolute; bottom: 30px; right: 30px; z-index: 1000; display: flex; flex-direction: column; gap: 10px; align-items: center; }
        .floating-button { width: 56px; height: 56px; line-height: 56px; text-align: center; color: white; border: none; border-radius: 50%; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.25); transition: background-color 0.2s; display: grid; place-items: center; }
        .recenter-button { background-color: white; color: #555; font-size: 24px; width: 48px; height: 48px; }
        .add-report-button { background-color: #4285f4; font-size: 32px; }
        .detail-modal-backdrop { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 2000; }
        .detail-modal-content { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 0; border-radius: 12px; width: 90%; max-width: 500px; z-index: 2002; overflow: hidden; }
        .detail-modal-image { width: 100%; height: 250px; object-fit: cover; background-color: #eee; }
        .detail-modal-no-image { width: 100%; height: 250px; background-color: #f0f0f0; display: flex; align-items: center; justify-content: center; color: #888; font-style: italic; }
        .detail-modal-text { padding: 25px; }
        .detail-modal-text h3 { margin-top: 0; }
        .detail-modal-text button { width: 100%; padding: 12px; margin-top: 20px; background: #ccc; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
        .modal-backdrop { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); z-index: 1001; }
        .modal-content { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 25px; border-radius: 12px; width: 90%; max-width: 400px; z-index: 1002; }
        .modal-content textarea, .modal-content select, .modal-content input, .modal-content button { width: 100%; padding: 12px; margin-top: 12px; border-radius: 8px; border: 1px solid #ccc; font-size: 16px; box-sizing: border-box; }
      `}</style>
      
      <div className="map-container-wrapper">
        <div className={`side-panel ${isPanelOpen ? '' : 'closed'}`}>
            <h3>{panelTitle}</h3>
            <div className="panel-controls">
                <button onClick={showNearbyEvents} disabled={!userLocation}>Ver cerca de mí</button>
                <button onClick={showMunicipalityEvents} disabled={!userMunicipality}>Ver en mi municipio</button>
            </div>
            <hr/>
            {panelContent.length > 0 ? panelContent.map(report => (
                <div key={report._id} className="report-item" onClick={() => setSelectedReport(report)}>
                    <div className="report-item-icon" style={{ backgroundColor: categoryColors[report.category] || 'grey' }}></div>
                    <div className="report-item-content">
                        <b>{report.category}</b>
                        <p>{report.description.length > 80 ? report.description.substring(0, 80) + '...' : report.description}</p>
                        <small>{new Date(report.createdAt).toLocaleString('es-GT')}</small>
                    </div>
                </div>
            )) : <p>No hay eventos que mostrar para esta selección.</p>}
        </div>

        <div className="map-wrapper">
            <button className="panel-toggle-button" onClick={() => setIsPanelOpen(!isPanelOpen)}>{isPanelOpen ? '<' : '>'}</button>
            <MapContainer center={center} zoom={15} maxZoom={20} style={{ height: "100%", width: "100%" }}>
                <ChangeView center={center} zoom={15} />
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
                
                {userLocation && <Marker position={userLocation} icon={userLocationIcon}><Popup>Esta es tu ubicación actual</Popup></Marker>}
                {reports.map(report => (
                    <Marker key={report._id} 
                            position={[report.location.coordinates[1], report.location.coordinates[0]]} 
                            icon={getColoredIcon(categoryColors[report.category] || 'grey')}>
                        <Popup>
                            <b>{report.category}</b><br/>{report.description}
                            {report.imageUrl && <img src={report.imageUrl} alt="Reporte" style={{width: '200px', marginTop: '10px', borderRadius: '5px'}}/>}
                        </Popup>
                    </Marker>
                ))}
            </MapContainer>
            
            <div className="floating-buttons">
                {userLocation && (
                    <button className="floating-button recenter-button" title="Centrar en mi ubicación" onClick={handleRecenter}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V2"/><path d="M12 22v-6"/><path d="M22 12h-6"/><path d="M8 12H2"/><path d="m18 6-4-4-4 4"/><path d="m6 18 4 4 4-4"/></svg>
                    </button>
                )}
                <button className="floating-button add-report-button" title="Agregar un nuevo reporte" onClick={() => setShowAddModal(true)}>+</button>
            </div>

            {selectedReport && (
                <>
                    <div className="detail-modal-backdrop" onClick={() => setSelectedReport(null)}></div>
                    <div className="detail-modal-content">
                        {selectedReport.imageUrl ? 
                            <img src={selectedReport.imageUrl} alt="Imagen del reporte" className="detail-modal-image"/> 
                            : 
                            <div className="detail-modal-no-image"><span>Sin imagen</span></div>
                        }
                        <div className="detail-modal-text">
                            <h3>{selectedReport.category}</h3>
                            <p>{selectedReport.description}</p>
                            <hr/>
                            <small>Municipio: {selectedReport.municipality || 'No especificado'}</small><br/>
                            <small>Fecha: {new Date(selectedReport.createdAt).toLocaleString('es-GT')}</small>
                            <button onClick={() => setSelectedReport(null)}>Cerrar</button>
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