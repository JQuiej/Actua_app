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
import imageCompression from 'browser-image-compression';
import { GoogleLogin } from '@react-oauth/google';
import { Toaster, toast } from 'sonner'; // ✅ NUEVO: Sonner en lugar de SweetAlert

axios.defaults.withCredentials = true;

const categoryColors = {
    'Emergencia': '#ef4444', 'Persona Perdida': '#ef4444', 'Ayuda': '#10b981', 
    'Calle en mal estado': '#f59e0b', 'Servicio público': '#3b82f6', 'Otro': '#6b7280', 
    'Accidente de Tráfico': '#dc2626', 'Donación de Sangre': '#ec4899', 
    'Fallo Eléctrico': '#eab308', 'Fuga de Agua': '#06b6d4',
    'Mascota Perdida': '#a855f7', 'Aviso Comunitario': '#2563eb', 
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
    'Mascota Perdida', 'Accidente de Tráfico', 'Fallo Eléctrico',
    'Fuga de Agua', 'Otro'
];

const RELEVANCE_ORDER = {
    'Emergencia': 1, 'Accidente de Tráfico': 2, 'Donación de Sangre': 3, 'Ayuda': 4
};

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

// ✅ NUEVA: Función para corregir orientación de imagen (Samsung fix)
const fixImageOrientation = async (file) => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Mantener dimensiones originales
                canvas.width = img.width;
                canvas.height = img.height;
                
                // Dibujar imagen correctamente orientada
                ctx.drawImage(img, 0, 0);
                
                // Convertir canvas a blob
                canvas.toBlob((blob) => {
                    resolve(new File([blob], file.name, { 
                        type: 'image/jpeg',
                        lastModified: Date.now()
                    }));
                }, 'image/jpeg', 0.95);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
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
  const [filterStatus, setFilterStatus] = useState('activo');

  const [newReportDesc, setNewReportDesc] = useState('');
  const [newReportCategory, setNewReportCategory] = useState('Otro');
  const [newReportImage, setNewReportImage] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
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
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.append('status', filterStatus);
    if (filterCategory !== 'Todas') params.append('category', filterCategory);
    
    axios.get(`${API_URL}/reports?${params.toString()}`)
      .then(res => setReports(res.data))
      .catch(err => console.error("Error cargando reportes:", err));

    const socket = io(API_URL);

    socket.on('new_report', (newReport) => {
        setReports(prev => [newReport, ...prev]);
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
        axios.get(`${API_URL}/stats`).then(res => setStats(res.data));
    });
    
    socket.on('report_updated', (updatedReport) => {
        setReports(prev => prev.map(report => 
            report._id === updatedReport._id ? updatedReport : report
        ));
        if (selectedReport && selectedReport._id === updatedReport._id) {
            setSelectedReport(updatedReport);
        }
    });
    
    return () => socket.disconnect();
  }, [userLocation, filterStatus, filterCategory, selectedReport]);

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

  // ✅ MEJORADO: Manejo de imágenes con corrección de orientación
  const handleSubmitReport = async () => {
    if (!userLocation || !newReportDesc) {
        toast.error('Se requiere tu ubicación y una descripción');
        return;
    }
    
    setIsSubmitting(true);
    const loadingToast = toast.loading('Subiendo reporte...');
    
    const formData = new FormData();
    formData.append('description', newReportDesc);
    formData.append('category', newReportCategory);
    formData.append('coordinates', JSON.stringify(userLocation));

    if (newReportImage) {
      try {
        // Corregir orientación primero (Samsung fix)
        const fixedImage = await fixImageOrientation(newReportImage);
        
        // Luego comprimir
        const compressedFile = await imageCompression(fixedImage, { 
            maxSizeMB: 1, 
            maxWidthOrHeight: 1920,
            useWebWorker: true
        });
        formData.append('image', compressedFile, compressedFile.name);
      } catch (error) {
        console.error("Error al procesar la imagen:", error);
        toast.error('No se pudo procesar la imagen', { id: loadingToast });
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
        toast.success('¡Reporte enviado! Gracias por contribuir', { id: loadingToast });
    } catch(err) {
        console.error("Error al crear reporte:", err);
        toast.error('Hubo un error al crear el reporte', { id: loadingToast });
    } finally {
        setIsSubmitting(false);
    }
  };
  
  const handleRecenter = () => { 
      if (userLocation) {
          setCenter(userLocation);
          toast.success('Centrado en tu ubicación');
      }
  };

  const handleReportAbuse = async (reportId) => {
    try {
        await axios.post(`${API_URL}/reports/${reportId}/report`, {});
        toast.success('Gracias por tu aporte. Revisaremos este reporte');
        const updatedReport = await axios.get(`${API_URL}/reports`);
        setReports(updatedReport.data);
    } catch (error) {
        toast.error(error.response?.data?.message || 'No se pudo enviar el reporte');
    }
  };

  const handleDeleteReport = async (reportId) => {
    toast.custom((t) => (
      <div style={{
        background: 'white',
        padding: '16px',
        borderRadius: '12px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <div>
          <strong>¿Estás seguro?</strong>
          <p style={{ margin: '8px 0', color: '#64748b' }}>
            Esta acción no se puede deshacer
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={() => toast.dismiss(t)}
            style={{
              padding: '8px 16px',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              background: 'white',
              cursor: 'pointer'
            }}
          >
            Cancelar
          </button>
          <button
            onClick={async () => {
              toast.dismiss(t);
              try {
                await axios.delete(`${API_URL}/reports/${reportId}`);
                toast.success('Reporte eliminado');
                setSelectedReport(null);
              } catch (error) {
                toast.error('No se pudo eliminar el reporte');
              }
            }}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: '6px',
              background: '#ef4444',
              color: 'white',
              cursor: 'pointer'
            }}
          >
            Eliminar
          </button>
        </div>
      </div>
    ), { duration: Infinity });
  };
  
  const handleConfirmReport = async (reportId) => {
    try {
        const response = await axios.post(
            `${API_URL}/reports/${reportId}/confirm`, 
            {}
        );
        
        toast.success(response.data.message);
        
        const updatedReports = await axios.get(`${API_URL}/reports`);
        setReports(updatedReports.data);
        
        const updatedReport = updatedReports.data.find(r => r._id === reportId);
        if (updatedReport) setSelectedReport(updatedReport);
        
    } catch (error) {
        toast.error('No se pudo confirmar el reporte');
    }
  };
  
  const handleResolveReport = async (reportId) => {
    toast.custom((t) => (
      <div style={{
        background: 'white',
        padding: '16px',
        borderRadius: '12px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <div>
          <strong>¿Marcar como resuelto?</strong>
          <p style={{ margin: '8px 0', color: '#64748b' }}>
            Esto indicará que la situación ya fue atendida
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={() => toast.dismiss(t)}
            style={{
              padding: '8px 16px',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              background: 'white',
              cursor: 'pointer'
            }}
          >
            Cancelar
          </button>
          <button
            onClick={async () => {
              toast.dismiss(t);
              try {
                await axios.patch(`${API_URL}/reports/${reportId}/resolve`, {});
                toast.success('¡Marcado como resuelto!');
                const updatedReports = await axios.get(`${API_URL}/reports`);
                setReports(updatedReports.data);
                setSelectedReport(null);
              } catch (error) {
                toast.error('No se pudo actualizar');
              }
            }}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: '6px',
              background: '#10b981',
              color: 'white',
              cursor: 'pointer'
            }}
          >
            Confirmar
          </button>
        </div>
      </div>
    ), { duration: Infinity });
  };

  const googleLoginSuccess = () => {
  const width = 500;
  const height = 600;
  const left = window.screen.width / 2 - width / 2;
  const top = window.screen.height / 2 - height / 2;
  
  const popup = window.open(
    `${API_URL}/auth/google`,
    'Google Login',
    `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
  );
  
  // Escuchar mensajes del popup
  const messageHandler = (event) => {
    // Verificar origen por seguridad
    if (event.origin !== API_URL) return;
    
    if (event.data === 'login_success') {
      // Recargar datos del usuario
      axios.get(`${API_URL}/auth/me`).then(res => {
        if (res.data) {
          setUser(res.data);
          if (res.data.role === 'admin') setIsAdmin(true);
          toast.success(`¡Bienvenido ${res.data.displayName}!`);
        }
      }).catch(err => {
        console.error('Error al obtener usuario:', err);
        toast.error('Error al iniciar sesión');
      });
      
      // Limpiar listener
      window.removeEventListener('message', messageHandler);
    } else if (event.data === 'login_failure') {
      toast.error('Error al iniciar sesión con Google');
      window.removeEventListener('message', messageHandler);
    }
  };
  
  window.addEventListener('message', messageHandler);
  
  // Fallback: si el popup se cierra sin mensaje
  const checkPopup = setInterval(() => {
    if (popup && popup.closed) {
      clearInterval(checkPopup);
      window.removeEventListener('message', messageHandler);
      
      // Verificar si el usuario se autenticó
      setTimeout(() => {
        axios.get(`${API_URL}/auth/me`).then(res => {
          if (res.data && !user) {
            setUser(res.data);
            if (res.data.role === 'admin') setIsAdmin(true);
            toast.success(`¡Bienvenido ${res.data.displayName}!`);
          }
        });
      }, 1000);
    }
  }, 500);
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

  const handleLogout = async () => {
    try {
        await axios.get(`${API_URL}/auth/logout`);
        // Si el servidor devuelve 2xx, la lógica de abajo se ejecuta.
    } catch (error) {
        // Si el servidor devuelve 401, cae aquí.
        // Aquí no se muestra el toast de error porque sabemos que el 401 es esperado/funcional.
        console.warn('Advertencia al cerrar sesión (Posiblemente 401 esperado):', error); 
    }

    // Estas líneas se ejecutan *después* del try o el catch.
    setUser(null);
    setIsAdmin(false);
    toast.success('Sesión cerrada correctamente');

    // ... Recargar reportes ...
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.append('status', filterStatus);
    if (filterCategory !== 'Todas') params.append('category', filterCategory);
    axios.get(`${API_URL}/reports?${params.toString()}`)
        .then(res => setReports(res.data))
        .catch(err => console.error("Error cargando reportes:", err));
};  

    const handleAddReportClick = () => {
    if (user) {
        // Si hay usuario logueado, abre el modal
        setShowAddModal(true);
    } else {
        // Si no hay usuario, muestra el mensaje para loguearse
        toast.info('Para agregar un reporte, primero debes iniciar sesión. ');
        // O podrías redirigir al usuario: navigate('/login');
    }
};

  // RETURN DEL COMPONENTE PRINCIPAL
  return (
    <>
    <Toaster 
        position="top-right" 
        expand={true}
        richColors
        closeButton
      />

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
                    <img 
                        src={user.image || user.picture || 'https://via.placeholder.com/48'} 
                        alt="Perfil"
                        onError={(e) => {
                            e.target.onerror = null;
                            e.target.src = 'https://ui-avatars.com/api/?name=' + 
                                encodeURIComponent(user.displayName || 'User') + 
                                '&background=2563eb&color=fff&size=48';
                        }}
                    />
                    <div>
                        <p className="display-name">{user.displayName || user.name || 'Usuario'}</p>
                        <a 
                            href="#" 
                            onClick={(e) => {
                                e.preventDefault();
                                handleLogout();
                            }} 
                            className="logout-link"
                        >
                            Cerrar sesión
                        </a>
                    </div>
                </div>
            ) : ( 
                <div style={{ marginBottom: '20px' }}>
                    <button
                        onClick={googleLoginSuccess}
                        style={{
                            width: '100%',
                            padding: '12px',
                            background: 'white',
                            border: '1px solid #dadce0',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '12px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: '500',
                            color: '#3c4043',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                            e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
                            e.target.style.backgroundColor = '#f8f9fa';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.boxShadow = 'none';
                            e.target.style.backgroundColor = 'white';
                        }}
                    >
                        <svg width="18" height="18" viewBox="0 0 18 18">
                            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
                            <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707 0-.593.102-1.17.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"/>
                            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
                        </svg>
                        Continuar con Google
                    </button>
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
                
                <button 
                    className="floating-button add-report-button" 
                    // Usamos 'user ? ... : ...' para el título
                    title={
                        user 
                        ? (isLocating ? "Obteniendo ubicación..." : "Agregar reporte") 
                        : "Inicia sesión para agregar un reporte"
                    } 
                    // Llamamos a la nueva función
                    onClick={handleAddReportClick} 
                    // El botón se deshabilita si está localizando, NO si no hay usuario
                    disabled={isLocating}
                >
                    +
                </button>
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
                            <div className="detail-modal-image-container">
                                <img 
                                    src={selectedReport.imageUrl} 
                                    alt="Imagen del reporte" 
                                    className="detail-modal-image"
                                    // ... dentro del onClick de la imagen ...
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const img = e.target;
                                        
                                        if (!img.classList.contains('expanded')) {
                                            // --- EXPANDIR LA IMAGEN ---
                                            
                                            // 1. Crear el backdrop
                                            const backdrop = document.createElement('div');
                                            backdrop.className = 'image-expanded-backdrop';
                                            
                                            // 2. CAMBIO IMPORTANTE: Colocar el backdrop en el body
                                            document.body.appendChild(backdrop);
                                            
                                            // 3. CAMBIO IMPORTANTE: Mover la imagen al backdrop
                                            backdrop.appendChild(img); 
                                            
                                            // 4. Agregar la clase 'expanded'
                                            img.classList.add('expanded');
                                            
                                            // 5. Configurar el cierre
                                            backdrop.onclick = () => {
                                                // Al cerrar, mover la imagen de vuelta a su contenedor original
                                                const originalContainer = document.querySelector('.detail-modal-image-container'); // ¡Asegúrate de que este selector sea correcto!
                                                if (originalContainer) {
                                                    originalContainer.appendChild(img);
                                                }
                                                img.classList.remove('expanded');
                                                backdrop.remove();
                                            };

                                        } else {
                                            // --- CERRAR LA IMAGEN ---
                                            // La lógica de cierre ya está manejada por el backdrop.onclick
                                        }
                                    }}
                                />
                                <div className="image-hint">Toca para expandir</div>
                            </div>
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
    </>
  );
}

export default App;