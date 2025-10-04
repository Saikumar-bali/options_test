import React from 'react';
import {
  Box,
  Container,
  Typography,
  Grid,
  AppBar,
  Toolbar,
  Button,
  IconButton,
  Paper,
  useTheme,
  useMediaQuery
} from '@mui/material';

import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import LiveTvIcon from '@mui/icons-material/LiveTv';
import SettingsIcon from '@mui/icons-material/Settings';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import NotificationsIcon from '@mui/icons-material/Notifications';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';

const TradingDashboard = ({
  refreshKey,
  onLevelAdded,
  SupportResistanceForm,
  PriceChart,
  LevelsDisplay,
  toggleTheme
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
    { id: 'sr', label: 'Support/Resistance', icon: <ShowChartIcon /> },
    { id: 'live', label: 'Live Track', icon: <LiveTvIcon /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon /> }
  ];

  const [activeNav, setActiveNav] = React.useState('dashboard');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* App Bar */}
      <AppBar position="static" color="default" elevation={1} sx={{ bgcolor: 'background.paper' }}>
        <Toolbar>
          <Box sx={{ display: 'flex', alignItems: 'center', mr: 2 }}>
            <ShowChartIcon color="primary" sx={{ fontSize: 32, mr: 1 }} />
            <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
              TradeBot Pro
            </Typography>
          </Box>

          {!isMobile && (
            <Box sx={{ display: 'flex', flexGrow: 1, ml: 3 }}>
              {navItems.map((item) => (
                <Button
                  key={item.id}
                  startIcon={item.icon}
                  onClick={() => setActiveNav(item.id)}
                  sx={{
                    mx: 1,
                    fontWeight: activeNav === item.id ? 'bold' : 'normal',
                    color: activeNav === item.id ? 'primary.main' : 'text.primary',
                    borderBottom: activeNav === item.id ? '2px solid' : 'none',
                    borderColor: 'primary.main',
                    borderRadius: 0
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </Box>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', ml: 'auto' }}>
            <IconButton color="inherit" onClick={toggleTheme}>
              {theme.palette.mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
            <IconButton color="inherit">
              <NotificationsIcon />
            </IconButton>
            <IconButton color="inherit">
              <AccountCircleIcon />
            </IconButton>
            {isMobile && (
              <IconButton color="inherit">
                <MenuIcon />
              </IconButton>
            )}
          </Box>
        </Toolbar>
      </AppBar>

      {/* Main Container */}
      <Container maxWidth="xl" sx={{ py: 4, flex: 1 }}>
        <Box sx={{ mb: 4, textAlign: 'center' }}>
          <Typography
            variant="h4"
            component="h1"
            gutterBottom
            sx={{
              fontWeight: 'bold',
              color: 'text.primary',
              background: 'linear-gradient(90deg, #1976d2 0%, #2196f3 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}
          >
            {activeNav === 'dashboard' && 'Dashboard'}
            {activeNav === 'sr' && 'Support / Resistance'}
            {activeNav === 'live' && 'Live Track'}
            {activeNav === 'settings' && 'Settings'}
          </Typography>
          <Typography variant="subtitle1" color="textSecondary">
            {activeNav === 'dashboard' && 'Welcome to your trading control panel.'}
            {activeNav === 'sr' && 'Manage Support & Resistance Levels for Strategic Trading'}
            {activeNav === 'live' && 'Live price tracking and analytics'}
            {activeNav === 'settings' && 'Manage preferences and configurations'}
          </Typography>
        </Box>

        {/* Conditional Rendering */}
        {activeNav === 'sr' && (
          <Grid container spacing={3} sx={{ height: 'calc(100vh - 220px)' }}>
            <Grid item xs={12} md={4} sx={{ display: 'flex', flexDirection: 'column' }}>
              <Paper
                elevation={3}
                sx={{
                  borderRadius: 3,
                  p: 3,
                  flex: 1,
                  mb: 3,
                  borderLeft: '4px solid',
                  borderColor: 'primary.main',
                  background: theme.palette.mode === 'dark'
                    ? 'linear-gradient(to bottom right, #1a1a2e, #16213e)'
                    : 'linear-gradient(to bottom right, #f8f9ff, #eef2ff)'
                }}
              >
                <SupportResistanceForm onLevelAdded={onLevelAdded} />
              </Paper>

              <Paper
                elevation={3}
                sx={{
                  borderRadius: 3,
                  p: 3,
                  flex: 1,
                  background: theme.palette.mode === 'dark'
                    ? 'linear-gradient(to bottom right, #1a1a2e, #16213e)'
                    : 'linear-gradient(to bottom right, #f8f9ff, #eef2ff)'
                }}
              >
                <LevelsDisplay refreshKey={refreshKey} />
              </Paper>
            </Grid>

            <Grid item xs={12} md={8} sx={{ height: '100%' }}>
              <Paper
                elevation={3}
                sx={{
                  borderRadius: 3,
                  p: 3,
                  height: '100%',
                  background: theme.palette.mode === 'dark'
                    ? 'linear-gradient(to bottom right, #1a1a2e, #16213e)'
                    : 'linear-gradient(to bottom right, #f8f9ff, #eef2ff)'
                }}
              >
                <PriceChart refreshKey={refreshKey} />
              </Paper>
            </Grid>
          </Grid>
        )}

        {activeNav === 'dashboard' && (
          <Paper elevation={3} sx={{ p: 3, borderRadius: 3 }}>
            <Typography variant="h6">Welcome to TradeBot Pro</Typography>
            <Typography>Use the navigation to get started.</Typography>
          </Paper>
        )}

        {activeNav === 'live' && (
          <Paper elevation={3} sx={{ p: 3, borderRadius: 3 }}>
            <Typography variant="h6">Live Price Tracking</Typography>
            <PriceChart refreshKey={refreshKey} />
          </Paper>
        )}

        {activeNav === 'settings' && (
          <Paper elevation={3} sx={{ p: 3, borderRadius: 3 }}>
            <Typography variant="h6">Settings</Typography>
            <LevelsTable refreshKey={refreshKey} />
          </Paper>
        )}
      </Container>
    </Box>
  );
};

export default TradingDashboard;
