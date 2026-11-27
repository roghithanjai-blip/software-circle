-- schema_v4.sql: run after schema_v3.sql. Safe to re-run.
-- Profile photos: the browser now resizes to 1024 px before upload, so the bucket only needs room for that. 5 MB is a safety cap.
update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/png','image/jpeg','image/webp'] where id = 'avatars';
