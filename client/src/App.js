import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap, ZoomControl } from 'react-leaflet';
import MarkerClusterGroup from '@changey/react-leaflet-markercluster';

// Estilos
import './App.css';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

import L from 'leaflet';
import Swal from 'sweetalert2';
import imageCompression from 'browser-image-compression';

const categoryColors = {
    'Emergencia': '#d9534f', 'Ayuda': '#5cb85c', 'Calle en mal estado': '#f0ad4e',
    'Servicio público': '#5bc0de', 'Otro': '#777777', 'Accidente de Tráfico': '#b30000',
    'Donación de Sangre': '#ff4f81', 'Fallo Eléctrico': '#ffd700', 'Fuga de Agua': '#4682b4',
    'Mascota Perdida/Encontrada': '#9370db', 'Aviso Comunitario': '#337ab7', 'Actividad Social/Cultural': '#8a2be2'
};

const getColoredIcon = (color) => {
    const markerHtmlStyles = `
        background-color: ${color}; width: 2rem; height: 2rem; display: block;
        left: -1rem; top: -1rem; position: relative; border-radius: 2rem 2rem 0;
        transform: rotate(45deg); border: 1px solid #FFFFFF; box-shadow: 0 0 5px rgba(0,0,0,0.5);`;
    return L.divIcon({
      className: "my-custom-pin", iconAnchor: [0, 24], popupAnchor: [0, -36],
      html: `<span style="${markerHtmlStyles}" />`
    });
};

const userLocationIcon = getColoredIcon('#4285F4');

function ChangeView({ center, zoom }) {
    const map = useMap();
    map.setView(center, zoom);
    return null;
}

function MapResizer({ isPanelOpen }) {
    const map = useMap();
    useEffect(() => {
        const timer = setTimeout(() => { map.invalidateSize(); }, 400); 
        return () => clearTimeout(timer);
    }, [isPanelOpen, map]);
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
    'Emergencia': 1, 'Accidente de Tráfico': 2, 'Donación de Sangre': 3, 'Ayuda': 4
};

const showNotification = (title, body) => {
    if (Notification.permission === 'granted') {
        new Notification(title, { body: body, icon: '/logo192.png' });
    }
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
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if ("Notification" in window && Notification.permission !== "denied") {
        Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    axios.get(`${API_URL}/auth/me`, { withCredentials: true }).then(res => {
        if (res.data) {
            setUser(res.data);
            if (res.data.role === 'admin') { setIsAdmin(true); }
        }
    }).catch(() => setUser(null));
  }, []);

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
            setUserMunicipality(address.city || address.town || address.state_district || address.county || address.state || '');
        } catch (e) { console.error("Error obteniendo municipio", e); }
      },
      () => { 
        console.warn("No se pudo obtener la ubicación.");
        setIsLocating(false);
      }
    );
  }, []);

  useEffect(() => {
    axios.get(`${API_URL}/reports`, { withCredentials: true })
      .then(res => setReports(res.data))
      .catch(err => console.error("Error cargando reportes:", err));

    const socket = io(API_URL, { withCredentials: true });
    socket.on('new_report', (newReport) => {
        setReports(prev => [newReport, ...prev]);
        if (userLocation && newReport.location && newReport.location.coordinates) {
            const reportLatLng = L.latLng(newReport.location.coordinates[1], newReport.location.coordinates[0]);
            const userLatLng = L.latLng(userLocation[0], userLocation[1]);
            const distance = userLatLng.distanceTo(reportLatLng);
            if (distance <= 5000) {
                showNotification(`Nuevo reporte: ${newReport.category}`, newReport.description);
            }
        }
    });
    socket.on('delete_report', (deletedReportId) => {
        setReports(prev => prev.filter(report => report._id !== deletedReportId));
    });
    return () => socket.disconnect();
  }, [userLocation]);

  const panelContent = useMemo(() => {
    let processedReports = [...reports];
    if (filterType === 'reported') {
      processedReports = processedReports.filter(report => report.reportCount > 0);
    } else if (filterType === 'nearby' && userLocation) {
      processedReports = processedReports.filter(report => report.location?.coordinates && L.latLng(userLocation).distanceTo([report.location.coordinates[1], report.location.coordinates[0]]) < 5000);
    } else if (filterType === 'municipality' && userMunicipality) {
      processedReports = processedReports.filter(report => report.municipality === userMunicipality);
    }
    if (filterCategory !== 'Todas') {
      processedReports = processedReports.filter(report => report.category === filterCategory);
    }
    if (filterType === 'reported') {
      processedReports.sort((a, b) => b.reportCount - a.reportCount);
    } else {
      processedReports.sort((a, b) => {
        const relevanceA = RELEVANCE_ORDER[a.category] || 99;
        const relevanceB = RELEVANCE_ORDER[b.category] || 99;
        if (relevanceA !== relevanceB) return relevanceA - relevanceB;
        if (userLocation && a.location?.coordinates && b.location?.coordinates) {
          const distA = L.latLng(userLocation).distanceTo([a.location.coordinates[1], a.location.coordinates[0]]);
          const distB = L.latLng(userLocation).distanceTo([b.location.coordinates[1], b.location.coordinates[0]]);
          return distA - distB;
        }
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    }
    return processedReports;
  }, [reports, filterType, filterCategory, userLocation, userMunicipality]);

  const handleSubmitReport = async () => {
    if (!userLocation || !newReportDesc) { Swal.fire({ icon: 'warning', title: 'Faltan datos', text: 'Se requiere tu ubicación y una descripción.' }); return; }
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
        Swal.fire({ icon: 'error', title: 'Error de imagen', text: 'No se pudo procesar la imagen.' });
        setIsSubmitting(false); return;
      }
    }
    try {
        await axios.post(`${API_URL}/reports`, formData, { headers: { 'Content-Type': 'multipart/form-data' }, withCredentials: true });
        setShowAddModal(false);
        setNewReportDesc(''); setNewReportCategory('Otro'); setNewReportImage(null);
        Swal.fire({ icon: 'success', title: '¡Reporte Enviado!', timer: 2000, showConfirmButton: false });
    } catch(err) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Hubo un error al crear el reporte.' });
    } finally {
        setIsSubmitting(false);
    }
  };
  
  const handleRecenter = () => { if (userLocation) setCenter(userLocation); };

  const handleReportAbuse = async (reportId) => {
    try {
        await axios.post(`${API_URL}/reports/${reportId}/report`, {}, { withCredentials: true });
        Swal.fire('Reportado', 'Gracias por tu aporte.', 'success');
    } catch (error) {
        Swal.fire('Error', error.response?.data?.message || 'No se pudo enviar el reporte.', 'error');
    }
  };

  const handleDeleteReport = async (reportId) => {
    try {
        await axios.delete(`${API_URL}/reports/${reportId}`, { withCredentials: true });
        Swal.fire('Eliminado', 'El reporte ha sido eliminado.', 'success');
        setSelectedReport(null);
    } catch (error) {
        Swal.fire('Error', 'No se pudo eliminar el reporte.', 'error');
    }
  };


  return (
    <div className="map-container-wrapper">
        {isMobile && isPanelOpen && <div className="panel-overlay" onClick={() => setIsPanelOpen(false)}></div>}
        <div className={`side-panel ${isPanelOpen ? 'open' : 'closed'}`}>
            <button className="panel-internal-close-button" onClick={() => setIsPanelOpen(false)}>&times;</button>
            <h3>Eventos</h3>
            {user ? (
                <div className="user-info">
                    {/* ...código de usuario logueado... */}
                </div>
            ) : ( 
                <a href={`${API_URL}/auth/google`} className="google-login-button">
                    Iniciar sesión con Google
                </a>
            )}
            <div className="panel-controls">
                {isAdmin && (<button onClick={() => setFilterType('reported')}>Ver Reportados</button>)}
                <button onClick={() => setFilterType('all')}>Ver Todos</button>
                <button onClick={() => setFilterType('nearby')} disabled={isLocating || !userLocation}>Ver cerca de mí</button>
                <button onClick={() => setFilterType('municipality')} disabled={isLocating || !userMunicipality}>Ver en mi municipio</button>
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                    <option value="Todas">Todas las categorías</option>
                    {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
            </div>
            <div className="reports-list">
              {panelContent.map(report => (
                  <div key={report._id} className="report-item" onClick={() => setSelectedReport(report)}>
                      <div className="report-item-icon" style={{ backgroundColor: categoryColors[report.category] || 'grey' }}></div>
                      <div className="report-item-content">
                          <b>{report.category}</b>
                          {isAdmin && report.reportCount > 0 && <small style={{ color: 'red', fontWeight: 'bold' }}>{report.reportCount} {report.reportCount === 1 ? 'reporte' : 'reportes'}</small>}
                          <p>{report.description.substring(0, 80)}...</p>
                          <small>{new Date(report.createdAt).toLocaleString('es-GT')}</small>
                      </div>
                  </div>
              ))}
            </div>
        </div>
        <div className="map-wrapper">
            {!isPanelOpen && <button className="panel-toggle-button" data-is-panel-open={isPanelOpen} onClick={() => setIsPanelOpen(true)}>›</button>}
            <MapContainer center={center} zoom={10} maxZoom={17} minZoom={5} style={{ height: "100%", width: "100%" }} zoomControl={false}>
                <ChangeView center={center} zoom={10} />
                <MapResizer isPanelOpen={isPanelOpen} />
                <ZoomControl position="topright" />
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' noWrap={true} />
                {userLocation && <Marker position={userLocation} icon={userLocationIcon}><Popup>Ubicación actual</Popup></Marker>}
                <MarkerClusterGroup>
                    {reports.map(report => (
                        <Marker key={report._id} 
                                position={[report.location.coordinates[1], report.location.coordinates[0]]} 
                                icon={getColoredIcon(categoryColors[report.category] || 'grey')}>
                            <Popup><b>{report.category}</b><br/>{report.description}</Popup>
                        </Marker>
                    ))}
                </MarkerClusterGroup>
            </MapContainer>
            <div className="floating-buttons">
                {userLocation && <button className="floating-button recenter-button" title="Centrar" onClick={handleRecenter}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V2"/><path d="M12 22v-6"/><path d="M22 12h-6"/><path d="M8 12H2"/><path d="m18 6-4-4-4 4"/><path d="m6 18 4 4 4-4"/></svg>
                </button>}
                {user && (<button className="floating-button add-report-button" title={isLocating ? "Obteniendo ubicación..." : "Agregar reporte"} onClick={() => setShowAddModal(true)} disabled={isLocating}>+</button>)}
            </div>
            {selectedReport && (
                <>
                    <div className="detail-modal-backdrop" onClick={() => setSelectedReport(null)}></div>
                    <div className="detail-modal-content">
                        <button className="detail-modal-close-button" onClick={() => setSelectedReport(null)}>&times;</button>
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
                            <br/>
                            {isAdmin && selectedReport.reportCount > 0 && <p style={{ color: 'red', fontWeight: 'bold' }}>Este evento tiene {selectedReport.reportCount} {selectedReport.reportCount === 1 ? 'reporte' : 'reportes'}.</p>}
                            {user && !isAdmin && (<button onClick={() => handleReportAbuse(selectedReport._id)}>Reportar Abuso</button>)}
                            {isAdmin && (<button onClick={() => handleDeleteReport(selectedReport._id)} style={{backgroundColor: 'red', color: 'white'}}>Eliminar Reporte</button>)}
                        </div>
                    </div>
                </>
            )}
            {showAddModal && (
                <>
                    <div className="modal-backdrop" onClick={() => !isSubmitting && setShowAddModal(false)}></div>
                    <div className="modal-content">
                        <h3>Crear Nuevo Reporte</h3>
                        <label htmlFor="description" className="form-label">Descripción</label>
                        <textarea id="description" rows="3" placeholder="Describe el evento..." value={newReportDesc} onChange={e => setNewReportDesc(e.target.value)} />
                        <label htmlFor="category" className="form-label">Categoría</label>
                        <select id="category" value={newReportCategory} onChange={e => setNewReportCategory(e.target.value)}>
                            {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                        <label className="form-label">Subir imagen (opcional)</label>
                        <div className="file-input-wrapper">
                            <label htmlFor="image-upload" className="file-input-label">
                                {newReportImage ? newReportImage.name : 'Seleccionar archivo'}
                            </label>
                            <input type="file" id="image-upload" className="file-input" accept="image/*" onChange={(e) => setNewReportImage(e.target.files[0])} />
                        </div>
                        <button onClick={handleSubmitReport} disabled={isSubmitting} className="btn btn-primary">{isSubmitting ? 'Enviando...' : 'Enviar Reporte'}</button>
                        <button onClick={() => setShowAddModal(false)} disabled={isSubmitting} className="btn btn-secondary">Cancelar</button>
                    </div>
                </>
            )}
        </div>
      </div>
  );
}

export default App;