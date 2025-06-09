import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Post from '../models/Post.js';
import Comment from '../models/Comment.js';
import Notification from '../models/Notification.js';
import upload from '../middleware/upload.js';
import cloudinary from '../config/cloudinary.js';
import { authMiddleware } from '../middleware/auth.js';  // Add this import
import passport from 'passport';

const router = express.Router();

router.post('/register', async (req, res) => {
  const { email, password, firstName, lastName, dateOfBirth } = req.body;
  const exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ msg: "Email exists" });

  const hashed = await bcrypt.hash(password, 10);
  const user = new User({ 
    email, 
    password: hashed,
    firstName,
    lastName,
    dateOfBirth: new Date(dateOfBirth)
  });
  await user.save();
  res.status(201).json({ msg: "User created" });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ msg: "Invalid email" });

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(400).json({ msg: "Wrong password" });

  const token = jwt.sign({ 
    id: user._id, 
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profilePicture: user.profilePicture
  }, process.env.JWT_SECRET, {
    expiresIn: '1h'
  });

  res.json({ token });
});

// Update the update route
router.put('/update', authMiddleware, async (req, res) => {
  const { firstName, lastName, currentPassword, newPassword, profilePicture, about } = req.body;
  
  try {
    const user = await User.findById(req.user.id);
    
    // If updating password, verify current password
    if (newPassword) {
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) return res.status(400).json({ msg: "Current password is incorrect" });
      user.password = await bcrypt.hash(newPassword, 10);
    }

    // Check if name is being updated
    const isNameChanged = user.firstName !== firstName || user.lastName !== lastName;

    // Update basic info without password
    user.firstName = firstName;
    user.lastName = lastName;
    user.about = about;
    if (profilePicture) {
      user.profilePicture = profilePicture;
    }

    await user.save();

    // If name changed, update posts and comments
    if (isNameChanged) {
      await Post.updateMany(
        { author: user._id },
        { 
          firstName: firstName,
          lastName: lastName,
          profilePicture: profilePicture || user.profilePicture
        }
      );

      await Comment.updateMany(
        { author: user._id },
        { 
          firstName: firstName,
          lastName: lastName,
          profilePicture: profilePicture || user.profilePicture
        }
      );
    }

    // Generate new token with updated info
    const token = jwt.sign({ 
      id: user._id, 
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePicture: user.profilePicture
    }, process.env.JWT_SECRET, {
      expiresIn: '1h'
    });

    res.json({ token, msg: "Profile updated successfully" });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ msg: "Server error" });
  }
});

// Get user profile by ID
router.get('/profile/:userId', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('-password'); // Exclude password
    
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching user profile" });
  }
});

// Add this new route
router.post('/refresh-token', authMiddleware, async (req, res) => {
  try {
    const { user } = req.body;
    
    // Generate new token with updated user info
    const token = jwt.sign({ 
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePicture: user.profilePicture
    }, process.env.JWT_SECRET, {
      expiresIn: '1h'
    });

    res.json({ token });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ msg: "Error refreshing token" });
  }
});

// Update the upload-avatar endpoint
router.post('/upload-avatar', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ msg: "No image file provided" });
    }

    const b64 = Buffer.from(req.file.buffer).toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;
    
    const uploadResponse = await cloudinary.uploader.upload(dataURI, {
      folder: 'profile_pictures',
      resource_type: 'auto'
    });

    // Handle notifications update with try-catch
    try {
      // Update user in database
      await User.findByIdAndUpdate(req.user.id, {
        profilePicture: uploadResponse.secure_url
      });

      // Update all posts
      await Post.updateMany(
        { author: req.user.id },
        { profilePicture: uploadResponse.secure_url }
      );

      // Update all comments
      await Comment.updateMany(
        { author: req.user.id },
        { profilePicture: uploadResponse.secure_url }
      );

      // Update all notifications (wrap in try-catch in case Notification collection doesn't exist)
      await Notification.updateMany(
        { 'sender._id': req.user.id },
        { 'sender.profilePicture': uploadResponse.secure_url }
      );

    } catch (updateErr) {
      console.error('Error updating references:', updateErr);
      // Continue execution even if updating references fails
    }

    res.json({ imageUrl: uploadResponse.secure_url });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ msg: "Error uploading avatar" });
  }
});

// Update the subscribe route
router.put('/subscribe/:userId', authMiddleware, async (req, res) => {
  try {
    const userToSubscribe = await User.findById(req.params.userId);
    if (!userToSubscribe) {
      return res.status(404).json({ msg: "User not found" });
    }

    // Convert IDs to strings for comparison
    const currentUserId = req.user._id.toString();
    const targetUserId = req.params.userId;

    if (currentUserId === targetUserId) {
      return res.status(400).json({ msg: "Cannot subscribe to yourself" });
    }

    // Check if already subscribed
    const isSubscribed = userToSubscribe.subscribers.some(
      id => id.toString() === currentUserId
    );
    
    if (isSubscribed) {
      // Unsubscribe
      userToSubscribe.subscribers = userToSubscribe.subscribers.filter(
        id => id.toString() !== currentUserId
      );
    } else {
      // Subscribe
      userToSubscribe.subscribers.push(req.user._id);
      
      try {
        // Create notification
        const notification = new Notification({
          recipient: userToSubscribe._id,
          sender: {
            _id: req.user._id,
            firstName: req.user.firstName,
            lastName: req.user.lastName,
            profilePicture: req.user.profilePicture
          },
          type: 'subscribe'
        });
        await notification.save();
      } catch (notifErr) {
        console.error('Notification creation error:', notifErr);
        // Continue even if notification fails
      }
    }

    await userToSubscribe.save();

    res.json({ 
      isSubscribed: !isSubscribed,
      subscriberCount: userToSubscribe.subscribers.length
    });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ msg: "Error updating subscription" });
  }
});

// Update the get subscription status route
router.get('/subscribe/:userId', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    const isSubscribed = user.subscribers.some(
      id => id.toString() === req.user._id.toString()
    );

    res.json({
      isSubscribed,
      subscriberCount: user.subscribers.length
    });
  } catch (err) {
    console.error('Subscription status error:', err);
    res.status(500).json({ msg: "Error getting subscription status" });
  }
});

// Add after other routes, before export
router.delete('/delete-account', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Delete all posts and their associated comments
    const userPosts = await Post.find({ author: userId });
    for (const post of userPosts) {
      // Delete comments for each post
      await Comment.deleteMany({ post: post._id });
    }
    await Post.deleteMany({ author: userId });

    // Delete all comments made by the user on other posts
    await Comment.deleteMany({ author: userId });

    // Delete all notifications where user is sender or recipient
    await Notification.deleteMany({
      $or: [
        { 'sender._id': userId },
        { recipient: userId }
      ]
    });

    // Remove user from other users' subscribers arrays
    await User.updateMany(
      { subscribers: userId },
      { $pull: { subscribers: userId } }
    );

    // Finally, delete the user
    await User.findByIdAndDelete(userId);

    res.json({ msg: "Account deleted successfully" });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ msg: "Error deleting account" });
  }
});

router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback',
  passport.authenticate('google', { session: false }),
  (req, res) => {
    // Generate JWT token
    const token = jwt.sign({ 
      id: req.user._id, 
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      profilePicture: req.user.profilePicture
    }, process.env.JWT_SECRET, {
      expiresIn: '1h'
    });

    // Redirect to frontend with token
    res.redirect(`http://localhost:3000/oauth-callback?token=${token}`);
  }
);

export default router;
