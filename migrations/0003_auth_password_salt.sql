-- Separate PBKDF2 salt from the password hash, following the working authentication flow.
-- Existing accounts remain valid: the Worker supports legacy combined hashes and upgrades
-- them to this format after the next successful login.
ALTER TABLE users ADD COLUMN password_salt TEXT;
