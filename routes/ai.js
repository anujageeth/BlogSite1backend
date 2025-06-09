import express from 'express';
import axios from 'axios';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.post('/improve-content', authMiddleware, async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ msg: "Content is required" });
    }

    console.log('Making request to TextGears API...');
    const response = await axios.post('https://api.textgears.com/grammar', { // Changed endpoint
      text: content,
      language: 'en-US',
      key: process.env.TEXTGEARS_API_KEY,
      ai: true // Enable AI suggestions
    });

    console.log('TextGears API Response:', response.data);

    // Check if response has the expected structure
    if (!response.data || !response.data.response || !response.data.response.errors) {
      console.error('Unexpected API response structure:', response.data);
      return res.status(500).json({ msg: "Invalid API response" });
    }

    // Process grammar corrections
    let improvedContent = content;
    const corrections = response.data.response.errors;
    
    if (corrections.length > 0) {
      corrections.forEach(correction => {
        if (correction.bad && correction.better && correction.better.length > 0) {
          improvedContent = improvedContent.replace(
            correction.bad,
            correction.better[0]
          );
        }
      });
    }

    res.json({ 
      improvedContent,
      corrections: corrections.length,
      original: content 
    });
  } catch (err) {
    console.error('Content improvement error details:', {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status
    });
    
    res.status(500).json({ 
      msg: "Error improving content",
      error: err.message,
      details: err.response?.data 
    });
  }
});

export default router;