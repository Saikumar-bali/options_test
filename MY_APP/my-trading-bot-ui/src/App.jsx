import React, { useState } from 'react';
import SupportResistanceForm from './components/SupportResistanceForm';
import LevelsDisplay from './components/LevelsDisplay';
import PriceChart from './components/PriceChart';
import TradingDashboard from './components/TradingDashboard';

const App = () => {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedPage, setSelectedPage] = useState('dashboard'); // track current page

  const handleLevelAdded = () => {
    setRefreshKey(prev => prev + 1);
    new Audio('/success.mp3').play().catch(e => console.log("Audio error:", e));
  };

  const handleNavClick = (id) => {
    setSelectedPage(id);
  };

  return (
    <TradingDashboard
      refreshKey={refreshKey}
      onLevelAdded={handleLevelAdded}
      SupportResistanceForm={SupportResistanceForm}
      PriceChart={PriceChart}
      LevelsDisplay={LevelsDisplay}
      selectedPage={selectedPage}
      onNavClick={handleNavClick}
    />
  );
};

export default App;
