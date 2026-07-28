import React, { useState } from 'react';
import Map, { Layer } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

// Insert your free Mapbox public token here
const MAPBOX_TOKEN = 'YOUR_MAPBOX_ACCESS_TOKEN';

// City Presets (NYC, Chicago, LA)
const CITIES = {
  NYC: { latitude: 40.7128, longitude: -74.0060, zoom: 15.5, pitch: 60, bearing: -17.6 },
  CHI: { latitude: 41.8781, longitude: -87.6298, zoom: 15.5, pitch: 60, bearing: -17.6 },
  LA:  { latitude: 34.0522, longitude: -118.2437, zoom: 15.5, pitch: 60, bearing: -17.6 }
};

// 3D Building Extrusion Layer (Applies Cyberpunk Style to City Footprints)
const building3DLayer = {
  id: '3d-buildings',
  source: 'composite',
  'source-layer': 'building',
  filter: ['==', 'extrude', 'true'],
  type: 'fill-extrusion',
  minzoom: 13,
  paint: {
    'fill-extrusion-color': '#05101c',
    'fill-extrusion-height': ['get', 'height'],
    'fill-extrusion-base': ['get', 'min_height'],
    'fill-extrusion-opacity': 0.85
  }
};

export default function SpatialTelemetryMap() {
  const [activeCity, setActiveCity] = useState('NYC');
  const [viewState, setViewState] = useState(CITIES.NYC);

  const handleCitySwitch = (cityKey) => {
    setActiveCity(cityKey);
    setViewState(CITIES[cityKey]);
  };

  return (
    <div className="relative w-full h-screen bg-[#030712] text-[#00f3ff] font-mono select-none overflow-hidden">
      
      {/* 1. Live 3D City Map Canvas */}
      <Map
        {...viewState}
        onMove={(evt) => setViewState(evt.viewState)}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        style={{ width: '100%', height: '100%' }}
      >
        <Layer {...building3DLayer} />
      </Map>

      {/* 2. Top-Left Stitch Telemetry Panel */}
      <div className="absolute top-4 left-4 z-10 w-72 bg-[#080d1a]/85 backdrop-blur-md border border-[#00f3ff]/30 p-4 rounded-lg shadow-[0_0_20px_rgba(0,243,255,0.15)]">
        <div className="flex justify-between items-center text-[10px] text-[#00f3ff]/70 tracking-widest border-b border-[#00f3ff]/20 pb-2">
          <span>GRID_PERFORMANCE // SEC_04</span>
          <span className="text-emerald-400 font-bold">TS_882</span>
        </div>
        
        <div className="mt-3 space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-400">POWER_LOAD</span>
            <span className="text-[#00f3ff] font-bold">84.2 GW</span>
          </div>
          <div className="w-full bg-gray-900 h-1.5 rounded-full overflow-hidden">
            <div className="bg-[#00f3ff] h-full w-[84%] shadow-[0_0_8px_#00f3ff]"></div>
          </div>

          <div className="flex justify-between pt-1">
            <span className="text-gray-400">WATER_FLOW</span>
            <span className="text-[#ffaa00] font-bold">12.4 ML/s</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-[#00f3ff]/20">
          <div className="bg-[#030712]/60 p-2 rounded border border-[#00f3ff]/20">
            <div className="text-[9px] text-gray-400">NODES</div>
            <div className="text-lg font-bold text-white">1,402</div>
          </div>
          <div className="bg-[#030712]/60 p-2 rounded border border-[#00f3ff]/20">
            <div className="text-[9px] text-gray-400">UPTIME</div>
            <div className="text-lg font-bold text-[#00f3ff]">99.9%</div>
          </div>
        </div>
      </div>

      {/* 3. Center Lock-On Reticle Target */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-12 z-10 flex flex-col items-center pointer-events-none">
        <div className="text-[10px] bg-[#00f3ff] text-black font-bold px-1.5 py-0.5 rounded shadow-[0_0_10px_#00f3ff]">
          LOCK_ON
        </div>
        <div className="w-4 h-4 border-2 border-[#00f3ff] rotate-45 mt-1 animate-pulse"></div>
      </div>

      {/* 4. Bottom City Switcher Navigation */}
      <footer className="absolute bottom-0 left-0 right-0 z-10 flex justify-between items-center text-[10px] bg-[#080d1a]/90 border-t border-[#00f3ff]/30 px-6 py-2.5 backdrop-blur-md">
        <div className="flex gap-2">
          {Object.keys(CITIES).map((city) => (
            <button
              key={city}
              onClick={() => handleCitySwitch(city)}
              className={`px-3 py-1 rounded border font-bold transition ${
                activeCity === city
                  ? 'border-[#00f3ff] bg-[#00f3ff]/20 text-white shadow-[0_0_10px_rgba(0,243,255,0.3)]'
                  : 'border-gray-800 text-gray-500 hover:text-gray-300'
              }`}
            >
              {city}
            </button>
          ))}
        </div>
        <div className="text-[#00f3ff]/70 tracking-widest">
          SPATIAL_LINK: <span className="text-emerald-400 font-bold">{activeCity} // 3D_RENDER_ACTIVE</span>
        </div>
      </footer>

    </div>
  );
}
