import React, { useState, useEffect } from 'react';
import {
  Paper, Typography, Box, List, ListItem, ListItemText,
  CircularProgress, Alert, RadioGroup, FormControlLabel, Radio,
  FormControl, FormLabel, Chip
} from '@mui/material';
import axios from 'axios';

// Re-using the same styled label for consistency
const StyledRadioLabel = ({ label, isSelected }) => (
    <Box
      sx={{
        p: '12px 16px',
        bgcolor: isSelected ? 'primary.main' : 'rgba(255, 255, 255, 0.08)',
        color: isSelected ? 'primary.contrastText' : 'text.primary',
        borderRadius: 2, border: '2px solid',
        borderColor: isSelected ? 'primary.main' : 'rgba(255, 255, 255, 0.23)',
        transition: 'all 0.2s ease-in-out', fontWeight: 500,
        width: '100%', textAlign: 'center', cursor: 'pointer',
        '&:hover': {
          borderColor: 'primary.main',
        }
      }}
    >
      {label}
    </Box>
);

const LevelsDisplay = ({ refreshKey }) => {
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [availableExpiries, setAvailableExpiries] = useState([]);

  // Fetch available expiries once on mount
  useEffect(() => {
    const fetchExpiries = async () => {
      try {
        const response = await axios.get('http://localhost:3001/api/instruments/expiries');
        setAvailableExpiries(response.data);
        if (response.data.length > 0) {
          setSelectedExpiry(response.data[0].value); // Default to first expiry
        }
      } catch (err) {
        setError('Failed to load expiry dates.');
      }
    };
    fetchExpiries();
  }, []);

  // Fetch levels whenever the selected expiry or the refreshKey changes
  useEffect(() => {
    if (!selectedExpiry) return;

    const fetchLevels = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await axios.get(`http://localhost:3001/api/levels?expiry=${selectedExpiry}`);
        setLevels(response.data);
      } catch (err) {
        setError('Failed to fetch levels for the selected expiry.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchLevels();
  }, [selectedExpiry, refreshKey]);

  return (
    <Paper elevation={4} sx={{ p: 4, borderRadius: 4, height: '100%' }}>
      <Typography variant="h5" fontWeight={600} color="primary.light" gutterBottom>
        Active Trading Levels
      </Typography>
      
      <FormControl component="fieldset" sx={{ mb: 3 }}>
        <FormLabel component="legend" sx={{ fontWeight: 600, mb: 1.5 }}>View Levels For Expiry</FormLabel>
        <RadioGroup row value={selectedExpiry} onChange={(e) => setSelectedExpiry(e.target.value)} sx={{ gap: 2, flexWrap: 'wrap' }}>
          {availableExpiries.map((exp) => (
            <FormControlLabel
              key={exp.value} value={exp.value}
              control={<Radio sx={{ display: 'none' }} />}
              label={<StyledRadioLabel label={exp.label} isSelected={selectedExpiry === exp.value} />}
              sx={{ m: 0, flex: '1 1 150px' }}
            />
          ))}
        </RadioGroup>
      </FormControl>

      {loading && <CircularProgress />}
      {error && <Alert severity="error">{error}</Alert>}
      {!loading && !error && levels.length === 0 && (
        <Typography>No active levels found for this expiry.</Typography>
      )}

      <List>
        {levels.map((level) => (
          <ListItem key={level.id} divider sx={{ bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, mb: 1 }}>
            <ListItemText
              primary={`${level.symbol} - ${level.price_level}`}
              secondary={`Created: ${new Date(level.created_at).toLocaleString()}`}
            />
            <Chip
              label={level.level_type.toUpperCase()}
              color={level.level_type === 'support' ? 'success' : 'error'}
              size="small"
            />
          </ListItem>
        ))}
      </List>
    </Paper>
  );
};

export default LevelsDisplay;
