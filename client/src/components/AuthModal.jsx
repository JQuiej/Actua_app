import React, { useState } from 'react';
import './AuthModal.css';

const AuthModal = ({ onClose, onSuccess, apiUrl }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    displayName: '',
    confirmPassword: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    // Validaciones
    if (!formData.email || !formData.password) {
      setError('Por favor completa todos los campos');
      setIsLoading(false);
      return;
    }

    if (!isLogin) {
      if (!formData.displayName) {
        setError('Por favor ingresa tu nombre');
        setIsLoading(false);
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        setError('Las contraseñas no coinciden');
        setIsLoading(false);
        return;
      }
      if (formData.password.length < 6) {
        setError('La contraseña debe tener al menos 6 caracteres');
        setIsLoading(false);
        return;
      }
    }

    try {
      const endpoint = isLogin ? '/auth/local/login' : '/auth/local/register';
      const response = await fetch(`${apiUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          displayName: formData.displayName
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Error en la autenticación');
      }

      onSuccess(data.user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

const handleGoogleLogin = () => {
    const width = 500;
    const height = 600;
    // Centrar la ventana
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    // 1. Limpiar marca anterior
    localStorage.removeItem('auth_success');

    // 2. Abrir la ventana y guardar la referencia
    const popupWindow = window.open(
        `${apiUrl}/auth/google`,
        'Google Login',
        `width=${width},height=${height},left=${left},top=${top}`
    );

    if (!popupWindow) {
        alert('No se pudo abrir la ventana de inicio de sesión. Por favor, deshabilite el bloqueador de popups.');
        return;
    }

    let checkAuth;

    // 3. Polling cada 500ms (verificación más rápida)
    checkAuth = setInterval(() => {
        const authSuccess = localStorage.getItem('auth_success');
        
        // 🌟 MODIFICACIÓN CLAVE: Solo verificamos authSuccess, ignoramos popupWindow.closed
        // Esto evita el error de Cross-Origin-Opener-Policy
        if (authSuccess) {
            clearInterval(checkAuth);
            localStorage.removeItem('auth_success');

            // Éxito: La cookie se estableció, obtener usuario
            fetch(`${apiUrl}/auth/me`, { credentials: 'include' })
                .then(res => res.json())
                .then(user => {
                    if (user && user.id) {
                        // Forzar la actualización de la UI
                        onSuccess(user); 
                        
                        // Si la recarga no funcionó antes, podría ser un problema de caché.
                        // Usamos window.location.assign() para asegurar una carga fresca.
                        window.location.assign(window.location.href); 
                    } else {
                        console.error('Autenticación marcada, pero no se pudo obtener el perfil del usuario.');
                        onClose(); 
                    }
                })
                .catch(error => {
                    console.error('Error al obtener el perfil de usuario:', error);
                    onClose();
                });
        }
        
        // También incluimos una comprobación fuera del éxito, aunque dará el warning,
        // para detener el polling si el usuario cierra la ventana manualmente antes del timeout.
        if (popupWindow.closed) {
             clearInterval(checkAuth);
             onClose();
             console.log('Ventana de login cerrada por el usuario o por el servidor.');
        }

    }, 500); 

    // 4. Timeout de respaldo (2 minutos)
    setTimeout(() => {
        clearInterval(checkAuth);
        
        // Si el popup sigue abierto después del timeout, lo cerramos
        if (popupWindow && !popupWindow.closed) {
             popupWindow.close(); 
        }
        
        console.log('Timeout de autenticación alcanzado.');
        onClose();
    }, 120000); 
};

  return (
    <>
      <div className="auth-modal-backdrop" onClick={onClose}></div>
      <div className="auth-modal-content">
        <button className="auth-modal-close" onClick={onClose}>&times;</button>
        
        <h2>{isLogin ? 'Iniciar Sesión' : 'Crear Cuenta'}</h2>
        
        {error && (
          <div className="auth-error">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          {!isLogin && (
            <div className="form-group">
              <label htmlFor="displayName">Nombre completo</label>
              <input
                type="text"
                id="displayName"
                name="displayName"
                value={formData.displayName}
                onChange={handleChange}
                placeholder="Tu nombre"
                disabled={isLoading}
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">Correo electrónico</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="tu@email.com"
              disabled={isLoading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Contraseña</label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Mínimo 6 caracteres"
              disabled={isLoading}
            />
          </div>

          {!isLogin && (
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirmar contraseña</label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="Repite tu contraseña"
                disabled={isLoading}
              />
            </div>
          )}

          <button 
            type="submit" 
            className="auth-submit-btn"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="loading-spinner"></span>
            ) : (
              isLogin ? 'Iniciar Sesión' : 'Crear Cuenta'
            )}
          </button>
        </form>
            {/*
        <div className="auth-divider">
          <span>o continúa con</span>
        </div>

        <button
          onClick={handleGoogleLogin}
          className="google-login-btn"
          disabled={isLoading}
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707 0-.593.102-1.17.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
          </svg>
          Google
        </button>
        */}
        <div className="auth-switch">
          {isLogin ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
          {' '}
          <button 
            type="button" 
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
              setFormData({
                email: '',
                password: '',
                displayName: '',
                confirmPassword: ''
              });
            }}
            className="auth-switch-btn"
          >
            {isLogin ? 'Regístrate' : 'Inicia sesión'}
          </button>
        </div>
      </div>
    </>
  );
};

export default AuthModal;