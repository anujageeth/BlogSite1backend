import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User.js';

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "https://elastic-tasteful-begonia.glitch.me/api/auth/google/callback",
      scope: ['profile', 'email']
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user already exists
        let user = await User.findOne({ email: profile.emails[0].value });

        if (user) {
          // Update profile picture if it has changed
          if (profile.photos && profile.photos[0] && profile.photos[0].value !== user.profilePicture) {
            user.profilePicture = profile.photos[0].value;
            await user.save();
          }
          return done(null, user);
        }

        // Get high-quality profile picture
        const profilePicture = profile.photos && profile.photos[0] 
          ? profile.photos[0].value.replace('s96-c', 's400-c')  // Get larger image
          : '';

        // Create new user
        user = new User({
          email: profile.emails[0].value,
          firstName: profile.name.givenName,
          lastName: profile.name.familyName,
          password: `google_${accessToken}`, // Prefix password to identify Google users
          dateOfBirth: new Date(), // Default date
          profilePicture: profilePicture,
          about: `Hi, I'm ${profile.displayName}!` // Default about text
        });

        await user.save();

        // Log successful creation
        console.log('Created new user via Google OAuth:', {
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          profilePicture: user.profilePicture ? 'Set' : 'Not set'
        });

        done(null, user);
      } catch (err) {
        console.error('Google OAuth error:', err);
        done(err, null);
      }
    }
  )
);

export default passport;