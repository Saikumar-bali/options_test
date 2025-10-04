import React, { useState, useEffect, useCallback } from 'react';
import {
  TextField, Button, Box, FormControl, InputLabel, Select,
  MenuItem, Typography, Paper, RadioGroup,
  FormControlLabel, Radio, Alert, FormLabel, CircularProgress, Stack
} from '@mui/material';
import { AddCircleOutline } from '@mui/icons-material';
import axios from 'axios';

// A reusable styled component for our radio button labels for a consistent look
const StyledRadioLabel = ({ label, isSelected }) => (
    <Box
      sx={{
        p: '12px 16px',
        bgcolor: isSelected ? 'primary.light' : 'grey.100',
        color: isSelected ? 'primary.contrastText' : 'text.primary',
        borderRadius: 2, border: '2px solid',
        borderColor: isSelected ? 'primary.main' : 'grey.300',
        transition: 'all 0.2s ease-in-out', fontWeight: 500,
        width: '100%', textAlign: 'center', cursor: 'pointer',
        '&:hover': { borderColor: 'primary.main' }
      }}
    >
      {label}
    </Box>
);

const SupportResistanceForm = ({ onLevelAdded }) => {
  // State for user inputs
  const [symbol, setSymbol] = useState('NIFTY');
  const [level, setLevel] = useState('');
  const [type, setType] = useState('support');
  const [expiry, setExpiry] = useState('');
  const [selectedOption, setSelectedOption] = useState('');
  const [optionAction, setOptionAction] = useState('buy');

  // State for data fetched from API
  const [availableExpiries, setAvailableExpiries] = useState([]);
  const [availableOptions, setAvailableOptions] = useState([]);
  
  // State for UI status
  const [loadingExpiries, setLoadingExpiries] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Fetch expiry dates whenever the selected symbol changes
  useEffect(() => {
    if (!symbol) return;

    const fetchExpiries = async () => {
      setLoadingExpiries(true);
      setError('');
      setAvailableExpiries([]); // Clear old expiries
      setExpiry(''); // Reset selected expiry
      try {
        const response = await axios.get(`http://localhost:3001/api/instruments/expiries?index=${symbol}`);
        setAvailableExpiries(response.data);
        if (response.data.length > 0) {
          setExpiry(response.data[0].value); // Default to the first expiry
        }
      } catch (err) {
        setError('Failed to load expiry dates for the selected index.');
        console.error(err);
      } finally {
        setLoadingExpiries(false);
      }
    };

    fetchExpiries();
  }, [symbol]); // This effect runs when `symbol` changes

  // Fetch option contracts whenever the symbol or expiry changes
  useEffect(() => {
    if (!symbol || !expiry) {
        setAvailableOptions([]);
        return;
    };

    const fetchOptions = async () => {
      setLoadingOptions(true);
      setError('');
      setAvailableOptions([]); // Clear old options
      setSelectedOption(''); // Reset selected option
      try {
        const response = await axios.get(`http://localhost:3001/api/instruments/contracts?index=${symbol}&expiry=${expiry}`);
        setAvailableOptions(response.data);
      } catch (err) {
        setError('Failed to load option contracts.');
        console.error(err);
      } finally {
        setLoadingOptions(false);
      }
    };

    fetchOptions();
  }, [symbol, expiry]); // This effect runs when `symbol` or `expiry` changes

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!level || !symbol || !expiry) {
      setError('Symbol, Price Level, and Expiry are required.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await axios.post('http://localhost:3001/api/levels', {
        symbol: symbol,
        price_level: parseFloat(level),
        level_type: type,
        expiry: expiry,
        option_contract: selectedOption,
        option_action: selectedOption ? optionAction : null,
      });
      setSuccess(`Level for ${symbol} at ${level} added successfully!`);
      setLevel('');
      setSelectedOption('');
      onLevelAdded();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.response?.data?.message || 'An error occurred while saving the level.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Paper elevation={2} sx={{ p: 4, borderRadius: 4 }}>
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Stack spacing={3}>
          <Typography variant="h4" fontWeight={700} color="primary.main" textAlign="center">
            Set Trading Level
          </Typography>

          {error && <Alert severity="error">{error}</Alert>}
          {success && <Alert severity="success">{success}</Alert>}

          {/* --- 1. Select Index --- */}
          <FormControl fullWidth>
            <FormLabel component="legend" sx={{ fontWeight: 600, mb: 1.5 }}>Select Index</FormLabel>
            <Select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                <MenuItem value="NIFTY">NIFTY</MenuItem>
                <MenuItem value="BANKNIFTY">BANKNIFTY</MenuItem>
                <MenuItem value="FINNIFTY">FINNIFTY</MenuItem>
            </Select>
          </FormControl>

          {/* --- 2. Select Expiry (Dynamic) --- */}
          <FormControl component="fieldset" disabled={loadingExpiries}>
            <FormLabel component="legend" sx={{ fontWeight: 600, mb: 1.5 }}>Select Expiry</FormLabel>
            {loadingExpiries ? <CircularProgress /> : (
              <RadioGroup row value={expiry} onChange={(e) => setExpiry(e.target.value)} sx={{ gap: 2 }}>
                {availableExpiries.length > 0 ? availableExpiries.map((exp) => (
                  <FormControlLabel key={exp.value} value={exp.value} control={<Radio sx={{ display: 'none' }} />} label={<StyledRadioLabel label={exp.label} isSelected={expiry === exp.value} />} sx={{ m: 0, flex: 1 }} />
                )) : <Typography variant="body2" color="text.secondary">No expiries found.</Typography>}
              </RadioGroup>
            )}
          </FormControl>

          {/* --- 3. Price Level and Type --- */}
          <Stack direction="row" spacing={2}>
            <TextField fullWidth label="Price Level" type="number" value={level} onChange={(e) => setLevel(e.target.value)} required />
            <FormControl component="fieldset" fullWidth>
              <RadioGroup row value={type} onChange={(e) => setType(e.target.value)} sx={{ gap: 2, height: '100%' }}>
                <FormControlLabel value="support" control={<Radio sx={{ display: 'none' }} />} label={<StyledRadioLabel label="Support" isSelected={type === 'support'} />} sx={{ m: 0, flex: 1 }} />
                <FormControlLabel value="resistance" control={<Radio sx={{ display: 'none' }} />} label={<StyledRadioLabel label="Resistance" isSelected={type === 'resistance'} />} sx={{ m: 0, flex: 1 }} />
              </RadioGroup>
            </FormControl>
          </Stack>

          {/* --- 4. Select Option Contract (Dynamic) --- */}
          <FormControl fullWidth disabled={loadingOptions || availableOptions.length === 0}>
            <InputLabel>Associated Option Contract (Optional)</InputLabel>
            <Select value={selectedOption} onChange={(e) => setSelectedOption(e.target.value)} label="Associated Option Contract (Optional)">
              <MenuItem value=""><em>None</em></MenuItem>
              {loadingOptions ? <MenuItem disabled><CircularProgress size={20} sx={{mr: 1}}/> Loading Contracts...</MenuItem> :
                availableOptions.map((option) => (
                  <MenuItem key={option.id} value={option.id}>
                    {option.name}
                  </MenuItem>
                ))
              }
            </Select>
          </FormControl>

          {/* --- 5. Select Action --- */}
          {selectedOption && (
            <FormControl component="fieldset">
              <FormLabel component="legend" sx={{ fontWeight: 600, mb: 1.5 }}>Action for Contract</FormLabel>
              <RadioGroup row value={optionAction} onChange={(e) => setOptionAction(e.target.value)} sx={{ gap: 2 }}>
                <FormControlLabel value="buy" control={<Radio sx={{ display: 'none' }} />} label={<StyledRadioLabel label="Buy" isSelected={optionAction === 'buy'} />} sx={{ m: 0, flex: 1 }} />
                <FormControlLabel value="sell" control={<Radio sx={{ display: 'none' }} />} label={<StyledRadioLabel label="Sell" isSelected={optionAction === 'sell'} />} sx={{ m: 0, flex: 1 }} />
              </RadioGroup>
            </FormControl>
          )}

          <Button fullWidth type="submit" variant="contained" size="large" disabled={isSubmitting || loadingExpiries || loadingOptions} startIcon={isSubmitting ? <CircularProgress size={20} /> : <AddCircleOutline />}>
            {isSubmitting ? 'Adding...' : 'Add Level'}
          </Button>
        </Stack>
      </Box>
    </Paper>
  );
};

export default SupportResistanceForm;
