import express from 'express';
import Post from '../models/Post.js';
import Comment from '../models/Comment.js';
import Notification from '../models/Notification.js';
import cloudinary from '../config/cloudinary.js';
import upload from '../middleware/upload.js';
import { authMiddleware } from '../middleware/auth.js';
import User from '../models/User.js'; // Import User model

const router = express.Router();

// Get all posts
router.get('/', async (req, res) => {
  try {
    const posts = await Post.find()
      .populate({
        path: 'author',
        select: '_id firstName lastName profilePicture'
      })
      .sort({ createdAt: -1 });
    
    // Get comments count for each post
    const postsWithCounts = await Promise.all(posts.map(async post => {
      const commentsCount = await Comment.countDocuments({ post: post._id });
      const postObj = post.toObject();
      
      // Ensure author data is available
      if (!postObj.author) {
        postObj.author = {
          _id: postObj.author || post._id,
          firstName: postObj.firstName,
          lastName: postObj.lastName,
          profilePicture: postObj.profilePicture
        };
      }

      return {
        ...postObj,
        likes: post.likes?.length || 0,
        comments: commentsCount
      };
    }));
    
    res.json(postsWithCounts);
  } catch (err) {
    console.error('Error fetching posts:', err);
    res.status(500).json({ msg: "Error fetching posts" });
  }
});

// Create post
router.post('/', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { title, content } = req.body;
    
    let imageUrl = '';
    if (req.file) {
      try {
        // Convert buffer to base64
        const b64 = Buffer.from(req.file.buffer).toString('base64');
        const dataURI = `data:${req.file.mimetype};base64,${b64}`;
        
        // Upload to Cloudinary
        const uploadResponse = await cloudinary.uploader.upload(dataURI, {
          folder: 'blog_images',
          resource_type: 'auto'
        });
        
        imageUrl = uploadResponse.secure_url;
      } catch (uploadErr) {
        console.error('Cloudinary upload error:', uploadErr);
        return res.status(500).json({ msg: "Error uploading image" });
      }
    }

    const post = new Post({
      title,
      content,
      image: imageUrl,
      author: req.user.id,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      profilePicture: req.user.profilePicture // Add this line
    });

    await post.save();

    // Notify subscribers
    try {
      // Get current user's subscribers
      const currentUser = await User.findById(req.user.id);
      
      // Create notifications for all subscribers
      const notifications = currentUser.subscribers.map(subscriberId => ({
        recipient: subscriberId,
        sender: req.user.id,
        post: post._id,
        type: 'post_created'
      }));

      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
      }
    } catch (notifErr) {
      console.error('Error creating subscriber notifications:', notifErr);
      // Continue even if notification creation fails
    }

    res.status(201).json(post);
  } catch (err) {
    console.error('Post creation error:', err);
    res.status(500).json({ msg: "Error creating post", error: err.message });
  }
});

// Get user's posts
router.get('/user', authMiddleware, async (req, res) => {
  try {
    const posts = await Post.find({ author: req.user.id })
      .sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching user posts" });
  }
});

// Update the search route to handle userId
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q: searchTerm, searchIn = 'all', from, to, userId } = req.query;
    
    if (!searchTerm) {
      return res.json([]);
    }

    // If searching for users and no userId is provided
    if (searchIn === 'users' && !userId) {
      const users = await User.find({
        $or: [
          { firstName: { $regex: searchTerm, $options: 'i' } },
          { lastName: { $regex: searchTerm, $options: 'i' } },
          { email: { $regex: searchTerm, $options: 'i' } }
        ]
      })
      .select('firstName lastName email profilePicture')
      .limit(10);
      
      return res.json(users);
    }

    // Build search query
    let searchQuery = {};

    // Add user filter if userId is provided
    if (userId) {
      searchQuery.author = userId;
    }

    // Handle search scope
    if (searchIn === 'all') {
      searchQuery.$or = [
        { title: { $regex: searchTerm, $options: 'i' } },
        { content: { $regex: searchTerm, $options: 'i' } }
      ];
    } else if (searchIn === 'title') {
      searchQuery.title = { $regex: searchTerm, $options: 'i' };
    } else if (searchIn === 'content') {
      searchQuery.content = { $regex: searchTerm, $options: 'i' };
    }

    // Handle date range
    if (from || to) {
      searchQuery.createdAt = {};
      if (from) searchQuery.createdAt.$gte = new Date(from);
      if (to) searchQuery.createdAt.$lte = new Date(to + 'T23:59:59');
    }

    const posts = await Post.find(searchQuery)
      .populate('author', 'firstName lastName profilePicture')
      .sort({ createdAt: -1 })
      .limit(10);

    const postsWithCounts = await Promise.all(posts.map(async post => {
      const commentsCount = await Comment.countDocuments({ post: post._id });
      return {
        ...post.toObject(),
        comments: commentsCount
      };
    }));

    res.json(postsWithCounts);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ msg: "Error searching" });
  }
});

// Get single post
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', '_id firstName lastName profilePicture'); // Add _id explicitly
    if (!post) {
      return res.status(404).json({ msg: "Post not found" });
    }
    res.json(post);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching post" });
  }
});

// Delete post
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({ msg: "Post not found" });
    }

    // Check if user owns the post
    if (String(post.author) !== String(req.user.id)) {
      return res.status(403).json({ msg: "Not authorized to delete this post" });
    }

    // Delete all comments associated with the post
    await Comment.deleteMany({ post: post._id });

    // Delete the post
    await post.deleteOne();

    res.json({ msg: "Post and associated comments deleted successfully" });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ msg: "Error deleting post" });
  }
});

// Update the put route for editing posts
router.put('/:id', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({ msg: "Post not found" });
    }

    // Check if user owns the post
    if (String(post.author) !== String(req.user.id)) {
      return res.status(403).json({ msg: "Not authorized to edit this post" });
    }

    const { title, content } = req.body;
    post.title = title;
    post.content = content;

    // Handle image upload if provided
    if (req.file) {
      try {
        const b64 = Buffer.from(req.file.buffer).toString('base64');
        const dataURI = `data:${req.file.mimetype};base64,${b64}`;
        
        const uploadResponse = await cloudinary.uploader.upload(dataURI, {
          folder: 'blog_images',
          resource_type: 'auto'
        });
        
        post.image = uploadResponse.secure_url;
      } catch (uploadErr) {
        console.error('Cloudinary upload error:', uploadErr);
        return res.status(500).json({ msg: "Error uploading image" });
      }
    }

    await post.save();
    res.json({ msg: "Post updated successfully", post });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ msg: "Error updating post" });
  }
});

// Like/Unlike post
router.put('/:id/like', authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ msg: "Post not found" });

    // Check if post owner is liking their own post
    const isOwnPost = post.author.toString() === req.user.id;

    // Toggle like
    const userLiked = post.likes.includes(req.user.id);
    if (userLiked) {
      post.likes = post.likes.filter(id => id.toString() !== req.user.id);
    } else {
      post.likes.push(req.user.id);
      
      // Create notification only if it's not the post owner
      if (!isOwnPost) {
        const notification = new Notification({
          recipient: post.author,
          sender: req.user.id,
          post: post._id,
          type: 'like'
        });
        await notification.save();
      }
    }

    await post.save();
    res.json({
      likes: post.likes,
      isLiked: !userLiked
    });
  } catch (err) {
    console.error('Like error:', err);
    res.status(500).json({ msg: "Server error" });
  }
});

// Get post likes
router.get('/:id/likes', authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ msg: "Post not found" });
    }

    const isLiked = post.likes.includes(req.user.id);
    res.json({
      likes: post.likes.length,
      isLiked
    });
  } catch (err) {
    res.status(500).json({ msg: "Error fetching likes" });
  }
});

// Get post comments
router.get('/:id/comments', authMiddleware, async (req, res) => {
  try {
    const comments = await Comment.find({ post: req.params.id })
      .sort({ createdAt: -1 });
    res.json(comments);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching comments" });
  }
});

// Add comment
router.post('/:id/comments', authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ msg: "Post not found" });

    // Check if post owner is commenting on their own post
    const isOwnPost = post.author.toString() === req.user.id;

    const comment = new Comment({
      content: req.body.content,
      author: req.user.id,
      post: req.params.id,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      profilePicture: req.user.profilePicture
    });

    await comment.save();

    // Create notification only if it's not the post owner
    if (!isOwnPost) {
      const notification = new Notification({
        recipient: post.author,
        sender: req.user.id,
        post: post._id,
        type: 'comment'
      });
      await notification.save();
    }

    res.status(201).json(comment);
  } catch (err) {
    console.error('Error creating comment:', err);
    res.status(500).json({ msg: "Error creating comment" });
  }
});

// Delete comment
router.delete('/:postId/comments/:commentId', authMiddleware, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId);
    
    if (!comment) {
      return res.status(404).json({ msg: "Comment not found" });
    }

    // Check if user owns the comment or the post
    const post = await Post.findById(req.params.postId);
    const isCommentOwner = String(comment.author) === String(req.user.id);
    const isPostOwner = String(post.author) === String(req.user.id);

    if (!isCommentOwner && !isPostOwner) {
      return res.status(403).json({ msg: "Not authorized to delete this comment" });
    }

    await comment.deleteOne();
    res.json({ msg: "Comment deleted successfully" });
  } catch (err) {
    console.error('Delete comment error:', err);
    res.status(500).json({ msg: "Error deleting comment" });
  }
});

// Get user's posts by user ID
router.get('/user/:userId', authMiddleware, async (req, res) => {
  try {
    const posts = await Post.find({ author: req.params.userId })
      .sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching user posts" });
  }
});

export default router;
