// client/src/hooks/useNotifications.js

import { useState, useEffect, useCallback } from 'react';

const useNotifications = (userLocation) => {
  const [permission, setPermission] = useState('default');
  const [registration, setRegistration] = useState(null);

  // Registrar Service Worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js')
        .then((reg) => {
          console.log('Service Worker registrado:', reg);
          setRegistration(reg);
        })
        .catch((err) => {
          console.error('Error registrando Service Worker:', err);
        });
    }
  }, []);

  // Solicitar permisos
  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      console.warn('Este navegador no soporta notificaciones');
      return false;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      
      if (result === 'granted') {
        console.log('✅ Permiso de notificaciones concedido');
        return true;
      } else {
        console.log('❌ Permiso de notificaciones denegado');
        return false;
      }
    } catch (error) {
      console.error('Error solicitando permisos:', error);
      return false;
    }
  }, []);

  // Mostrar notificación local
  const showLocalNotification = useCallback(async (title, body, data = {}) => {
    if (permission !== 'granted') {
      console.log('No hay permiso para notificaciones');
      return;
    }

    // Si el navegador está en primer plano, usar Notification API
    if (document.visibilityState === 'visible') {
      new Notification(title, {
        body,
        icon: '/logo192.png',
        badge: '/logo192.png',
        vibrate: [200, 100, 200],
        data,
        requireInteraction: false
      });
    } 
    // Si está en background, usar Service Worker
    else if (registration) {
      try {
        await registration.showNotification(title, {
          body,
          icon: '/logo192.png',
          badge: '/logo192.png',
          vibrate: [200, 100, 200],
          data,
          requireInteraction: false
        });
      } catch (error) {
        console.error('Error mostrando notificación:', error);
      }
    }
  }, [permission, registration]);

  // Verificar si el reporte está cerca
  const isNearby = useCallback((reportLocation, maxDistance = 5000) => {
    if (!userLocation || !reportLocation) return false;

    const toRad = (value) => (value * Math.PI) / 180;
    const R = 6371000; // Radio de la Tierra en metros

    const lat1 = toRad(userLocation[0]);
    const lat2 = toRad(reportLocation[1]);
    const deltaLat = toRad(reportLocation[1] - userLocation[0]);
    const deltaLon = toRad(reportLocation[0] - userLocation[1]);

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return distance <= maxDistance;
  }, [userLocation]);

  // Notificar nuevo reporte si está cerca
  const notifyNewReport = useCallback((report) => {
    if (!report.location || !report.location.coordinates) return;

    const reportLocation = [
      report.location.coordinates[1],
      report.location.coordinates[0]
    ];

    if (isNearby(reportLocation)) {
      showLocalNotification(
        `🚨 Nuevo reporte: ${report.category}`,
        report.description,
        { reportId: report._id }
      );
    }
  }, [isNearby, showLocalNotification]);

  return {
    permission,
    requestPermission,
    showLocalNotification,
    notifyNewReport,
    registration
  };
};

export default useNotifications;