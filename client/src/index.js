import React from 'react';
import ReactDOM from 'react-dom/client';
// Ya no necesitas la siguiente línea, así que elimínala:
// import { GoogleOAuthProvider } from '@react-oauth/google'; 
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {/* Simplemente renderiza tu componente App directamente */}
    <App />
  </React.StrictMode>
);

reportWebVitals();