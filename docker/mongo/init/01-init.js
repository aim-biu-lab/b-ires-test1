// MongoDB initialization script
// Creates database user and default admin user on first startup

// Switch to admin database to create user
db = db.getSiblingDB('admin');

// Get credentials from environment variables
const mongoUser = process.env.MONGO_USER || 'bires_admin';
const mongoPassword = process.env.MONGO_PASSWORD || 'change_me_in_production';

// Create application database user if not exists
try {
  db.createUser({
    user: mongoUser,
    pwd: mongoPassword,
    roles: [
      { role: 'readWrite', db: 'bires' },
      { role: 'dbAdmin', db: 'bires' }
    ]
  });
  print('MongoDB user created: ' + mongoUser);
} catch (e) {
  if (e.code === 51003) {
    print('MongoDB user already exists: ' + mongoUser);
  } else {
    throw e;
  }
}

// Switch to application database
db = db.getSiblingDB('bires');

// Create default admin user if not exists
const adminUser = db.users.findOne({ email: 'admin@example.com' });

if (!adminUser) {
  // Password: admin123 (bcrypt hash)
  // IMPORTANT: Change this password in production!
  const bcryptHash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.S5F1K0b.n1CXJK';
  
  db.users.insertOne({
    _id: 'admin-' + new Date().getTime(),
    email: 'admin@example.com',
    username: 'admin',
    full_name: 'System Administrator',
    role: 'admin',
    is_active: true,
    hashed_password: bcryptHash,
    created_at: new Date(),
    updated_at: new Date()
  });
  
  print('Default admin user created: admin@example.com / admin123');
  print('IMPORTANT: Change this password immediately in production!');
}

// Create indexes
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ username: 1 }, { unique: true });

db.experiments.createIndex({ experiment_id: 1 }, { unique: true });
db.experiments.createIndex({ owner_id: 1 });
db.experiments.createIndex({ status: 1 });

db.sessions.createIndex({ session_id: 1 }, { unique: true });
db.sessions.createIndex({ experiment_id: 1 });
db.sessions.createIndex({ user_id: 1 });
db.sessions.createIndex({ status: 1 });

db.events.createIndex({ idempotency_key: 1 }, { unique: true });
db.events.createIndex({ session_id: 1 });
db.events.createIndex({ experiment_id: 1 });
db.events.createIndex({ event_type: 1 });
db.events.createIndex({ server_timestamp: -1 });

db.assets.createIndex({ asset_id: 1 }, { unique: true });
db.assets.createIndex({ experiment_id: 1 });

print('MongoDB initialization complete');

