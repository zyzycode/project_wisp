import { ScreenRegionSelector } from './components/Chat/ScreenRegionSelector';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

const rootElement = document.getElementById('root');

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      {new URLSearchParams(window.location.search).get('wispScreenSelector') === '1' ? <ScreenRegionSelector /> : <App />}
    </React.StrictMode>
  );
} else {
  console.error('Failed to find root element');
}
