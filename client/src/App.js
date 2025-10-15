import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap, ZoomControl } from 'react-leaflet';
import MarkerClusterGroup from '@changey/react-leaflet-markercluster';

import './App.css';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

import L from 'leaflet';
import Swal from 'sweetalert2';
import imageCompression from 'browser-image-compression';
import { GoogleLogin } from '@react-oauth/google';

axios.defaults.withCredentials = true;

const categoryColors = {
    'Emergencia': '#ef4444', 'Ayuda': '#10b981', 'Calle en mal estado': '#f59e0b',
    'Servicio público': '#3b82f6', 'Otro': '#6b7280', 'Accidente de Tráfico': '#dc2626',
    'Donación de Sangre': '#ec4899', 'Fallo Eléctrico': '#eab308', 'Fuga de Agua': '#06b6d4',
    'Mascota Perdida/Encontrada': '#a855f7', 'Aviso Comunitario': '#2563eb', 
    'Actividad Social/Cultural': '#8b5cf6'
};

const getColoredIcon = (color) => {
    const markerHtmlStyles = `
        background-color: ${color}; width: 2rem; height: 2rem; display: block;
        left: -1rem; top: -1rem; position: relative; border-radius: 2rem 2rem 0;
        transform: rotate(45deg); border: 2px solid #FFFFFF; 
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);`;
    return L.divIcon({
      className: "my-custom-pin", iconAnchor: [0, 24], popupAnchor: [0, -36],
      html: `<span style="${markerHtmlStyles}" />`
    });
};

const userLocationIcon = getColoredIcon('#2563eb');

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

// NUEVA: Función para formatear tiempo relativo
const timeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " años";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " meses";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " días";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + "h";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + "min";
    return "ahora";
};

const showNotification = (title, body) => {
    if (Notification.permission === 'granted') {
        new Notification(title, {
            body: body,
            icon: '/logo192.png',
            badge: '/logo192.png',
            vibrate: [200, 100, 200]
        });
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
  const [filterStatus, setFilterStatus] = useState('activo'); // NUEVO

  const [newReportDesc, setNewReportDesc] = useState('');
  const [newReportCategory, setNewReportCategory] = useState('Otro');
  const [newReportImage, setNewReportImage] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  
  // NUEVO: Estado para estadísticas
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if ("Notification" in window && Notification.permission !== "denied") {
        Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    axios.get(`${API_URL}/auth/me`).then(res => {
        if (res.data) {
            setUser(res.data);
            if (res.data.role === 'admin') { setIsAdmin(true); }
        }
    }).catch(err => {
        console.error("No se pudo obtener el usuario:", err);
    });
    
    // NUEVO: Obtener estadísticas
    axios.get(`${API_URL}/stats`).then(res => {
        setStats(res.data);
    }).catch(err => {
        console.error("Error obteniendo estadísticas:", err);
    });
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
            const response = await axios.get(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&countrycodes=gt&accept-language=es`
            );
            const address = response.data.address;
            setUserMunicipality(
                address.city || address.town || address.state_district || 
                address.county || address.state
            );
        } catch (e) { 
            console.error("Error obteniendo municipio", e); 
        }
      },
      () => { 
        console.warn("No se pudo obtener la ubicación.");
        setIsLocating(false);
      }
    );
  }, []);

  useEffect(() => {
    // Cargar reportes con filtros
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.append('status', filterStatus);
    if (filterCategory !== 'Todas') params.append('category', filterCategory);
    
    axios.get(`${API_URL}/reports?${params.toString()}`)
      .then(res => setReports(res.data))
      .catch(err => console.error("Error cargando reportes:", err));

    const socket = io(API_URL);

    socket.on('new_report', (newReport) => {
        setReports(prev => [newReport, ...prev]);
        
        // Actualizar estadísticas
        axios.get(`${API_URL}/stats`).then(res => setStats(res.data));

        if (userLocation && newReport.location && newReport.location.coordinates) {
            const reportLatLng = L.latLng(
                newReport.location.coordinates[1], 
                newReport.location.coordinates[0]
            );
            const userLatLng = L.latLng(userLocation[0], userLocation[1]);
            const distance = userLatLng.distanceTo(reportLatLng);

            if (distance <= 5000) {
                showNotification(
                    `Nuevo reporte: ${newReport.category}`, 
                    newReport.description
                );
            }
        }
    });

    socket.on('delete_report', (deletedReportId) => {
        setReports(prev => prev.filter(report => report._id !== deletedReportId));
        if (selectedReport && selectedReport._id === deletedReportId) {
            setSelectedReport(null);
        }
        // Actualizar estadísticas
        axios.get(`${API_URL}/stats`).then(res => setStats(res.data));
    });
    
    // NUEVO: Escuchar actualizaciones de reportes
    socket.on('report_updated', (updatedReport) => {
        setReports(prev => prev.map(report => 
            report._id === updatedReport._id ? updatedReport : report
        ));
        if (selectedReport && selectedReport._id === updatedReport._id) {
            setSelectedReport(updatedReport);
        }
    });
    
    return () => socket.disconnect();
  }, [userLocation, filterStatus, filterCategory]);

  const panelContent = useMemo(() => {
    let processedReports = [...reports];

    if (filterType === 'reported') {
      processedReports = processedReports.filter(
          report => report.reportCount && report.reportCount > 0
      );
    } else if (filterType === 'nearby' && userLocation) {
      processedReports = processedReports.filter(report => 
        L.latLng(userLocation).distanceTo([
            report.location.coordinates[1], 
            report.location.coordinates[0]
        ]) < 5000
      );
    } else if (filterType === 'municipality' && userMunicipality) {
      processedReports = processedReports.filter(
          report => report.municipality === userMunicipality
      );
    }

    if (filterType === 'reported') {
      processedReports.sort((a, b) => b.reportCount - a.reportCount);
    } else {
      processedReports.sort((a, b) => {
        // Ordenar por prioridad primero
        if (b.priority !== a.priority) return b.priority - a.priority;
        
        const relevanceA = RELEVANCE_ORDER[a.category] || 99;
        const relevanceB = RELEVANCE_ORDER[b.category] || 99;
        if (relevanceA !== relevanceB) return relevanceA - relevanceB;
        
        if (userLocation) {
          const distA = L.latLng(userLocation).distanceTo([
              a.location.coordinates[1], 
              a.location.coordinates[0]
          ]);
          const distB = L.latLng(userLocation).distanceTo([
              b.location.coordinates[1], 
              b.location.coordinates[0]
          ]);
          return distA - distB;
        }
        
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    }

    return processedReports;
  }, [reports, filterType, filterCategory, userLocation, userMunicipality]);

// CONTINUACIÓN DE APP.JS - FUNCIONES

  const handleSubmitReport = async () => {
    if (!userLocation || !newReportDesc) {
        Swal.fire({ 
            icon: 'warning', 
            title: 'Faltan datos', 
            text: 'Se requiere tu ubicación y una descripción.' 
        });
        return;
    }
    
    setIsSubmitting(true);
    const formData = new FormData();
    formData.append('description', newReportDesc);
    formData.append('category', newReportCategory);
    formData.append('coordinates', JSON.stringify(userLocation));

    if (newReportImage) {
      try {
        const compressedFile = await imageCompression(newReportImage, { 
            maxSizeMB: 1, 
            maxWidthOrHeight: 1920 
        });
        formData.append('image', compressedFile, compressedFile.name);
      } catch (error) {
        console.error("Error al comprimir la imagen:", error);
        Swal.fire({ 
            icon: 'error', 
            title: 'Error de imagen', 
            text: 'No se pudo procesar la imagen.' 
        });
        setIsSubmitting(false);
        return;
      }
    }

    try {
        await axios.post(`${API_URL}/reports`, formData, { 
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        setShowAddModal(false);
        setNewReportDesc(''); 
        setNewReportCategory('Otro'); 
        setNewReportImage(null);
        Swal.fire({ 
            icon: 'success', 
            title: '¡Reporte Enviado!', 
            text: 'Gracias por contribuir a tu comunidad',
            timer: 2500, 
            showConfirmButton: false 
        });
    } catch(err) {
        console.error("Error al crear reporte:", err);
        Swal.fire({ 
            icon: 'error', 
            title: 'Error', 
            text: 'Hubo un error al crear el reporte.' 
        });
    } finally {
        setIsSubmitting(false);
    }
  };
  
  const handleRecenter = () => { 
      if (userLocation) {
          setCenter(userLocation);
          Swal.fire({
              toast: true,
              position: 'top-end',
              icon: 'success',
              title: 'Centrado en tu ubicación',
              showConfirmButton: false,
              timer: 1500
          });
      }
  };

  const handleReportAbuse = async (reportId) => {
    try {
        await axios.post(`${API_URL}/reports/${reportId}/report`, {});
        Swal.fire({
            icon: 'success',
            title: 'Reportado', 
            text: 'Gracias por tu aporte. Revisaremos este reporte.',
            timer: 2500
        });
        // Actualizar el reporte localmente
        const updatedReport = await axios.get(`${API_URL}/reports`);
        setReports(updatedReport.data);
    } catch (error) {
        Swal.fire(
            'Error', 
            error.response?.data?.message || 'No se pudo enviar el reporte.', 
            'error'
        );
    }
  };

  const handleDeleteReport = async (reportId) => {
    const result = await Swal.fire({
        title: '¿Estás seguro?',
        text: 'Esta acción no se puede deshacer',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    });
    
    if (result.isConfirmed) {
        try {
            await axios.delete(`${API_URL}/reports/${reportId}`);
            Swal.fire({
                icon: 'success',
                title: 'Eliminado', 
                text: 'El reporte ha sido eliminado.',
                timer: 2000
            });
            setSelectedReport(null);
        } catch (error) {
            Swal.fire('Error', 'No se pudo eliminar el reporte.', 'error');
        }
    }
  };
  
  // NUEVO: Confirmar/Desconfirmar reporte
  const handleConfirmReport = async (reportId) => {
    try {
        const response = await axios.post(
            `${API_URL}/reports/${reportId}/confirm`, 
            {}
        );
        
        const Toast = Swal.mixin({
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true,
        });
        
        Toast.fire({
            icon: 'success',
            title: response.data.message
        });
        
        // Actualizar reportes
        const updatedReports = await axios.get(`${API_URL}/reports`);
        setReports(updatedReports.data);
        
        // Actualizar reporte seleccionado
        const updatedReport = updatedReports.data.find(r => r._id === reportId);
        if (updatedReport) setSelectedReport(updatedReport);
        
    } catch (error) {
        Swal.fire(
            'Error', 
            'No se pudo confirmar el reporte', 
            'error'
        );
    }
  };
  
  // NUEVO: Marcar como resuelto
  const handleResolveReport = async (reportId) => {
    const result = await Swal.fire({
        title: '¿Marcar como resuelto?',
        text: 'Esto indicará que la situación ya fue atendida',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Sí, marcar',
        cancelButtonText: 'Cancelar'
    });
    
    if (result.isConfirmed) {
        try {
            await axios.patch(`${API_URL}/reports/${reportId}/resolve`, {});
            Swal.fire({
                icon: 'success',
                title: '¡Marcado como resuelto!',
                timer: 2000
            });
            
            // Actualizar reportes
            const updatedReports = await axios.get(`${API_URL}/reports`);
            setReports(updatedReports.data);
            setSelectedReport(null);
        } catch (error) {
            Swal.fire('Error', error.response?.data?.message || 'No se pudo actualizar', 'error');
        }
    }
  };

  const googleLoginSuccess = () => {
    window.location.href = `${API_URL}/auth/google`;
  };

  // NUEVO: Determinar si el usuario puede confirmar este reporte
  const canConfirm = (report) => {
    return user && (!report.confirmedBy || !report.confirmedBy.includes(user._id));
  };
  
  // NUEVO: Determinar si el usuario puede resolver
  const canResolve = (report) => {
    if (!user) return false;
    return report.createdBy === user._id || isAdmin;
  };
  
  // NUEVO: Calcular distancia al reporte
  const getDistanceToReport = (report) => {
    if (!userLocation || !report.location) return null;
    const distance = L.latLng(userLocation).distanceTo([
        report.location.coordinates[1], 
        report.location.coordinates[0]
    ]);
    if (distance < 1000) return `${Math.round(distance)}m`;
    return `${(distance / 1000).toFixed(1)}km`;
  };

  // RETURN DEL COMPONENTE PRINCIPAL
  return (
    // CONTINUACIÓN - JSX DEL COMPONENTE

    <div className="map-container-wrapper">
        {isMobile && isPanelOpen && (
            <div className="panel-overlay" onClick={() => setIsPanelOpen(false)}></div>
        )}

        <div className={`side-panel ${isPanelOpen ? 'open' : 'closed'}`}>
            <button 
                className="panel-internal-close-button" 
                onClick={() => setIsPanelOpen(false)}
            >
                &times;
            </button>
            
            <h3> ActuaApp</h3>
            
            {/* NUEVO: Mostrar estadísticas */}
            {stats && (
                <div style={{
                    background: 'linear-gradient(135deg, #f8fafc 0%, #e0f2fe 100%)',
                    padding: '16px',
                    borderRadius: '12px',
                    marginBottom: '20px',
                    border: '1px solid var(--border-color)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--primary-color)' }}>
                                {stats.active}
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Activos</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--success-color)' }}>
                                {stats.resolved}
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Resueltos</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text-color)' }}>
                                {stats.total}
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Total</div>
                        </div>
                    </div>
                </div>
            )}
            
            {user ? (
                <div className="user-info">
                    <img src={user.image} alt="Perfil" />
                    <div>
                        <p className="display-name">{user.displayName}</p>
                        <a href={`${API_URL}/auth/logout`} className="logout-link">
                            Cerrar sesión
                        </a>
                    </div>
                </div>
            ) : ( 
                <div style={{ marginBottom: '20px' }}>
                    <GoogleLogin 
                        onSuccess={googleLoginSuccess} 
                        onError={() => console.log('Login Failed')} 
                    />
                </div>
            )}

            <div className="panel-controls">
                {isAdmin && (
                    <button onClick={() => setFilterType('reported')}>
                        Ver Reportados
                    </button>
                )}
                <button onClick={() => setFilterType('all')}>
                    Ver Todos
                </button>
                <button 
                    onClick={() => setFilterType('nearby')} 
                    disabled={isLocating || !userLocation}
                >
                    Ver cerca de mí
                </button>
                <button 
                    onClick={() => setFilterType('municipality')} 
                    disabled={isLocating || !userMunicipality}
                >
                    Ver en mi municipio
                </button>
                
                {/* NUEVO: Filtro por estado */}
                <select 
                    value={filterStatus} 
                    onChange={(e) => setFilterStatus(e.target.value)}
                    style={{ marginTop: '10px' }}
                >
                    <option value="all">Todos los estados</option>
                    <option value="activo">Activos</option>
                    <option value="resuelto">Resueltos</option>
                    <option value="verificado">Verificados</option>
                </select>
                
                <select 
                    value={filterCategory} 
                    onChange={(e) => setFilterCategory(e.target.value)}
                >
                    <option value="Todas">Todas las categorías</option>
                    {CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                    ))}
                </select>
            </div>
            
            <div className="reports-list">
              {panelContent.length === 0 ? (
                  <div style={{ 
                      textAlign: 'center', 
                      padding: '40px 20px', 
                      color: 'var(--text-muted)' 
                  }}>
                      <div style={{ fontSize: '48px', marginBottom: '16px' }}></div>
                      <p>No hay reportes para mostrar</p>
                  </div>
              ) : (
                  panelContent.map(report => (
                      <div 
                          key={report._id} 
                          className="report-item" 
                          onClick={() => setSelectedReport(report)}
                      >
                          <div 
                              className="report-item-icon" 
                              style={{ 
                                  backgroundColor: categoryColors[report.category] || 'grey' 
                              }}
                          ></div>
                          <div className="report-item-content">
                              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                  <b>{report.category}</b>
                                  
                                  {/* NUEVO: Badge de confirmaciones */}
                                  {report.confirmationCount > 0 && (
                                      <span className="confirmation-badge">
                                          {report.confirmationCount}
                                      </span>
                                  )}
                                  
                                  {/* Badge de reportes de abuso */}
                                  {isAdmin && report.reportCount > 0 && (
                                      <span className="report-badge">
                                          {report.reportCount}
                                      </span>
                                  )}
                                  
                                  {/* NUEVO: Estado */}
                                  {report.status !== 'activo' && (
                                      <span className={`status-badge ${report.status}`}>
                                          {report.status === 'resuelto' ? '✅' : '✓'} {report.status}
                                      </span>
                                  )}
                              </div>
                              
                              <p>{report.description.substring(0, 80)}...</p>
                              
                              <div style={{ 
                                  display: 'flex', 
                                  justifyContent: 'space-between', 
                                  alignItems: 'center',
                                  marginTop: '8px'
                              }}>
                                  <small>{timeAgo(report.createdAt)}</small>
                                  {userLocation && (
                                      <small style={{ 
                                          color: 'var(--primary-color)', 
                                          fontWeight: '600' 
                                      }}>
                                          {getDistanceToReport(report)}
                                      </small>
                                  )}
                              </div>
                          </div>
                      </div>
                  ))
              )}
            </div>
        </div>

        <div className="map-wrapper">
            {!isPanelOpen && (
                <button 
                    className="panel-toggle-button" 
                    data-is-panel-open={isPanelOpen} 
                    onClick={() => setIsPanelOpen(true)}
                >
                    ›
                </button>
            )}
            
            <MapContainer 
              center={center} 
              zoom={10} 
              maxZoom={17} 
              minZoom={5} 
              style={{ height: "100%", width: "100%" }}
              zoomControl={false}
            >
                <ChangeView center={center} zoom={10} />
                <MapResizer isPanelOpen={isPanelOpen} />
                
                <ZoomControl position="topright" />

                <TileLayer 
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" 
                  attribution='&copy; OpenStreetMap'
                  noWrap={true} 
                />
                
                {userLocation && (
                    <Marker position={userLocation} icon={userLocationIcon}>
                        <Popup> Tu ubicación actual</Popup>
                    </Marker>
                )}
                
                <MarkerClusterGroup>
                    {reports.map(report => (
                        <Marker 
                            key={report._id} 
                            position={[
                                report.location.coordinates[1], 
                                report.location.coordinates[0]
                            ]} 
                            icon={getColoredIcon(categoryColors[report.category] || 'grey')}
                        >
                            <Popup>
                                <div style={{ minWidth: '200px' }}>
                                    <b style={{ fontSize: '16px' }}>{report.category}</b>
                                    {report.confirmationCount > 0 && (
                                        <div style={{ 
                                            color: 'var(--success-color)', 
                                            fontSize: '12px',
                                            marginTop: '4px'
                                        }}>
                                            {report.confirmationCount} confirmaciones
                                        </div>
                                    )}
                                    <p style={{ margin: '8px 0' }}>{report.description}</p>
                                    <small style={{ color: 'var(--text-muted)' }}>
                                        {timeAgo(report.createdAt)}
                                    </small>
                                    <br/>
                                    <button 
                                        onClick={() => setSelectedReport(report)}
                                        style={{
                                            marginTop: '8px',
                                            padding: '6px 12px',
                                            background: 'var(--primary-color)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            fontSize: '12px'
                                        }}
                                    >
                                        Ver detalles
                                    </button>
                                </div>
                            </Popup>
                        </Marker>
                    ))}
                </MarkerClusterGroup>
            </MapContainer>
            
            <div className="floating-buttons">
                {userLocation && (
                    <button 
                        className="floating-button recenter-button" 
                        title="Centrar en mi ubicación" 
                        onClick={handleRecenter}
                    >
                        <svg 
                            xmlns="http://www.w3.org/2000/svg" 
                            width="24" 
                            height="24" 
                            viewBox="0 0 24 24" 
                            fill="none" 
                            stroke="currentColor" 
                            strokeWidth="2" 
                            strokeLinecap="round" 
                            strokeLinejoin="round"
                        >
                            <circle cx="12" cy="12" r="10"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                )}
                
                {user && (
                    <button 
                        className="floating-button add-report-button" 
                        title={isLocating ? "Obteniendo ubicación..." : "Agregar reporte"} 
                        onClick={() => setShowAddModal(true)} 
                        disabled={isLocating}
                    >
                        +
                    </button>
                )}
            </div>

            {/* MODAL DE DETALLE MEJORADO */}
            {selectedReport && (
                <>
                    <div 
                        className="detail-modal-backdrop" 
                        onClick={() => setSelectedReport(null)}
                    ></div>
                    <div className="detail-modal-content">
                        <button 
                            className="detail-modal-close-button" 
                            onClick={() => setSelectedReport(null)}
                        >
                            &times;
                        </button>
                        
                        {selectedReport.imageUrl ? 
                            <img 
                                src={selectedReport.imageUrl} 
                                alt="Imagen del reporte" 
                                className="detail-modal-image"
                            /> 
                            : 
                            <div className="detail-modal-no-image">
                                <span>No hay imagen disponible</span>
                            </div>
                        }
                        
                        <div className="detail-modal-text">
                            <h3>{selectedReport.category}</h3>
                            
                            {/* NUEVO: Estado visible */}
                            <div className={`status-badge ${selectedReport.status}`}>
                                {selectedReport.status === 'activo' && '🟢 Activo'}
                                {selectedReport.status === 'resuelto' && '✅ Resuelto'}
                                {selectedReport.status === 'verificado' && '✓ Verificado'}
                            </div>
                            
                            <p>{selectedReport.description}</p>
                            
                            <hr/>
                            
                            <small> Municipio: {selectedReport.municipality || 'No especificado'}</small>
                            <br/>
                            <small>{new Date(selectedReport.createdAt).toLocaleString('es-GT')}</small>
                            <br/>
                            {userLocation && (
                                <>
                                    <small> Distancia: {getDistanceToReport(selectedReport)}</small>
                                    <br/>
                                </>
                            )}
                            
                            {/* NUEVO: Mostrar confirmaciones */}
                            {selectedReport.confirmationCount > 0 && (
                                <p style={{ 
                                    color: 'var(--success-color)', 
                                    fontWeight: 'bold',
                                    marginTop: '12px'
                                }}>
                                     {selectedReport.confirmationCount} personas han confirmado este reporte
                                </p>
                            )}
                            
                            {isAdmin && selectedReport.reportCount > 0 && (
                                <p style={{ 
                                    color: 'var(--danger-color)', 
                                    fontWeight: 'bold',
                                    marginTop: '12px'
                                }}>
                                    Este evento tiene {selectedReport.reportCount} {selectedReport.reportCount === 1 ? 'reporte' : 'reportes'} de abuso.
                                </p>
                            )}
                            
                            {/* NUEVO: Botón de confirmar */}
                            {user && selectedReport.status === 'activo' && (
                                <button 
                                    className={`confirm-button ${!canConfirm(selectedReport) ? 'confirmed' : ''}`}
                                    onClick={() => handleConfirmReport(selectedReport._id)}
                                >
                                    {canConfirm(selectedReport) ? (
                                        <> Confirmar este reporte</>
                                    ) : (
                                        <> Ya confirmaste este reporte</>
                                    )}
                                </button>
                            )}
                            
                            {/* Botón de resolver */}
                            {canResolve(selectedReport) && selectedReport.status === 'activo' && (
                                <button 
                                    onClick={() => handleResolveReport(selectedReport._id)}
                                    style={{
                                        width: '100%',
                                        padding: '14px',
                                        marginTop: '12px',
                                        borderRadius: '10px',
                                        border: 'none',
                                        background: 'var(--success-color)',
                                        color: 'white',
                                        fontSize: '16px',
                                        fontWeight: '600',
                                        cursor: 'pointer'
                                    }}
                                >
                                     Marcar como resuelto
                                </button>
                            )}
                            
                            {/* Reportar abuso */}
                            {user && !isAdmin && (
                                <button 
                                    onClick={() => handleReportAbuse(selectedReport._id)}
                                    style={{
                                        width: '100%',
                                        padding: '14px',
                                        marginTop: '12px',
                                        borderRadius: '10px',
                                        border: '2px solid var(--danger-color)',
                                        background: 'white',
                                        color: 'var(--danger-color)',
                                        fontSize: '16px',
                                        fontWeight: '600',
                                        cursor: 'pointer'
                                    }}
                                >
                                     Reportar Abuso
                                </button>
                            )}
                            
                            {/* Eliminar (admin) */}
                            {isAdmin && (
                                <button 
                                    onClick={() => handleDeleteReport(selectedReport._id)} 
                                    style={{
                                        width: '100%',
                                        padding: '14px',
                                        marginTop: '12px',
                                        borderRadius: '10px',
                                        border: 'none',
                                        background: 'var(--danger-color)',
                                        color: 'white',
                                        fontSize: '16px',
                                        fontWeight: '600',
                                        cursor: 'pointer'
                                    }}
                                >
                                     Eliminar Reporte
                                </button>
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* MODAL CREAR REPORTE */}
            {showAddModal && (
                <>
                    <div 
                        className="modal-backdrop" 
                        onClick={() => !isSubmitting && setShowAddModal(false)}
                    ></div>
                    <div className="modal-content">
                        <h3> Crear Nuevo Reporte</h3>

                        <label htmlFor="description" className="form-label">
                            Descripción *
                        </label>
                        <textarea 
                            id="description" 
                            rows="4" 
                            placeholder="Describe detalladamente lo que sucede..." 
                            value={newReportDesc} 
                            onChange={e => setNewReportDesc(e.target.value)}
                            maxLength="500"
                        />
                        <small style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                            {newReportDesc.length}/500 caracteres
                        </small>

                        <label htmlFor="category" className="form-label">
                            Categoría *
                        </label>
                        <select 
                            id="category" 
                            value={newReportCategory} 
                            onChange={e => setNewReportCategory(e.target.value)}
                        >
                            {CATEGORIES.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                        
                        <label className="form-label">
                             Subir imagen (opcional)
                        </label>
                        <div className="file-input-wrapper">
                            <label htmlFor="image-upload" className="file-input-label">
                                {newReportImage ? (
                                    <>✓ {newReportImage.name}</>
                                ) : (
                                    <> Seleccionar archivo</>
                                )}
                            </label>
                            <input 
                                type="file" 
                                id="image-upload" 
                                className="file-input" 
                                accept="image/*" 
                                onChange={(e) => setNewReportImage(e.target.files[0])} 
                            />
                        </div>

                        <button 
                            onClick={handleSubmitReport} 
                            disabled={isSubmitting} 
                            className="btn btn-primary"
                        >
                            {isSubmitting ? (
                                <>
                                    <span className="loading-spinner"></span> Enviando...
                                </>
                            ) : (
                                <> Enviar Reporte</>
                            )}
                        </button>
                        <button 
                            onClick={() => setShowAddModal(false)} 
                            disabled={isSubmitting} 
                            className="btn btn-secondary"
                        >
                            Cancelar
                        </button>
                    </div>
                </>
            )}
        </div>
    </div>
  );
}

export default App;