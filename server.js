import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import postRoutes from './routes/posts.js';
import notificationRoutes from './routes/notifications.js';
// Add this import
import aiRoutes from './routes/ai.js';
import passport from './config/passport.js';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/notifications', notificationRoutes);
// Add this route
app.use('/api/ai', aiRoutes);
app.use(passport.initialize());

mongoose.connect(process.env.MONGO_URI)
  .then(() => app.listen(process.env.PORT, () => console.log("Server started at port", process.env.PORT)))
  .catch(err => console.error(err));

// Add after other environment checks
if (!process.env.TEXTGEARS_API_KEY) {
  console.error('TEXTGEARS_API_KEY is not set in environment variables');
  process.exit(1);
}
