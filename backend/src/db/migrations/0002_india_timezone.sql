-- Voltix serves homes in India only: every home runs on India Standard Time.
UPDATE homes SET timezone = 'Asia/Kolkata' WHERE timezone <> 'Asia/Kolkata';
