import React, { useState, useEffect } from 'react';
import { 
  Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, 
  Paper, Button, Box, IconButton, Tooltip, Chip, LinearProgress
} from '@mui/material';
import { Delete, Edit, Visibility } from '@mui/icons-material';
import axios from 'axios';

const LevelsTable = ({ refreshKey }) => {
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLevels = async () => {
      setLoading(true);
      try {
        const response = await axios.get('http://localhost:3001/api/levels');
        setLevels(response.data);
      } catch (error) {
        console.error('Failed to fetch levels:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLevels();
  }, [refreshKey]);

  const handleDelete = async (id) => {
    try {
      await axios.delete(`http://localhost:3001/api/levels/${id}`);
      setLevels(levels.filter((level) => level.id !== id));
    } catch (error) {
      console.error('Failed to delete level:', error);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Active Levels</Typography>
        <Typography variant="body2" color="textSecondary">
          {levels.length} active level(s)
        </Typography>
      </Box>
      
      {loading ? (
        <LinearProgress />
      ) : (
        <TableContainer component={Paper} sx={{ border: '1px solid #e0e0e0' }}>
          <Table size="small">
            <TableHead sx={{ bgcolor: '#f5f5f5' }}>
              <TableRow>
                <TableCell>Symbol</TableCell>
                <TableCell>Price Level</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {levels.map((level) => (
                <TableRow key={level.id} hover>
                  <TableCell sx={{ fontWeight: 'bold' }}>{level.symbol}</TableCell>
                  <TableCell sx={{ fontWeight: 'medium' }}>{level.price_level.toLocaleString()}</TableCell>
                  <TableCell>
                    <Chip 
                      label={level.level_type} 
                      size="small" 
                      color={level.level_type === 'support' ? 'success' : 'error'}
                      sx={{ textTransform: 'capitalize', fontWeight: 'bold' }}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label="Active" 
                      size="small" 
                      color="primary"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="View on chart">
                      <IconButton size="small" color="primary">
                        <Visibility fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit">
                      <IconButton size="small" color="secondary">
                        <Edit fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton 
                        size="small" 
                        color="error"
                        onClick={() => handleDelete(level.id)}
                      >
                        <Delete fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          {levels.length === 0 && (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="body1" color="textSecondary">
                No active levels found. Add your first support/resistance level.
              </Typography>
            </Box>
          )}
        </TableContainer>
      )}
    </Box>
  );
};

export default LevelsTable;