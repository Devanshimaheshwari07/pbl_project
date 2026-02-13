import re
import os
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, flash, session, jsonify
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import text, inspect
from sqlalchemy.exc import SQLAlchemyError

try:
    from twilio.rest import Client as TwilioClient
    _twilio_available = True
except Exception:
    _twilio_available = False

app = Flask(__name__)
app.jinja_env.cache = {}
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///users.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.secret_key = os.environ.get('RESQMED_SECRET_KEY', 'your_secret_key')

db = SQLAlchemy(app)

class User(db.Model):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), nullable=False)
    email = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    address = db.Column(db.String(200))
    age = db.Column(db.Integer)
    blood_group = db.Column(db.String(5))
    # Phase 5: New Fields
    gender = db.Column(db.String(20))
    phone = db.Column(db.String(20))
    profile_pic = db.Column(db.String(200)) # Path to file

class AmbulanceRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_email = db.Column(db.String(150), db.ForeignKey('user.email'))
    location = db.Column(db.String(100))
    status = db.Column(db.String(50), default='requested')

class MedicalProfile(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_email = db.Column(db.String(150), db.ForeignKey('user.email'), unique=True)
    blood_group = db.Column(db.String(5))
    emergency_contact = db.Column(db.String(50))
    # Phase 5: Expanded Medical Details
    allergies = db.Column(db.String(500))
    medications = db.Column(db.String(500))
    chronic_conditions = db.Column(db.String(500))
    surgeries = db.Column(db.String(500))

class BloodDonor(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150))
    blood_group = db.Column(db.String(5))
    contact = db.Column(db.String(50))
    city = db.Column(db.String(100))

class BloodRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    requester_name = db.Column(db.String(150))
    blood_group = db.Column(db.String(5))
    city = db.Column(db.String(100))
    reason = db.Column(db.String(200))

class SOSLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_email = db.Column(db.String(150))
    contact = db.Column(db.String(50))
    location = db.Column(db.String(100))
    message = db.Column(db.String(500))
    status = db.Column(db.String(50))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

def _sqlite_type_from_col(col):
    t = type(col.type).__name__.lower()
    if 'integer' in t: return 'INTEGER'
    if 'string' in t or 'text' in t: return 'TEXT'
    return 'TEXT'

def ensure_table_columns(model_class):
    engine = db.engine
    inspector = inspect(engine)
    table_name = model_class.__tablename__
    
    if table_name not in inspector.get_table_names():
        return # Create all will handle it if table missing
        
    existing_cols = {col['name'] for col in inspector.get_columns(table_name)}
    
    for col in model_class.__table__.columns:
        col_name = col.name
        if col_name not in existing_cols:
            sqlite_type = _sqlite_type_from_col(col)
            alter_sql = f'ALTER TABLE "{table_name}" ADD COLUMN "{col_name}" {sqlite_type}'
            try:
                with engine.connect() as conn:
                    conn.execute(text(alter_sql))
                    conn.commit()
                app.logger.info(f"Added column {col_name} to {table_name}")
            except Exception as ex:
                app.logger.error(f'Failed to add column {col_name} to {table_name}: {ex}')

def validate_username(username):
    return bool(re.match(r"^[A-Za-z0-9 ]+$", username))

def validate_password(password):
    return len(password) >= 8

def _send_sms_via_twilio(to_number: str, body: str) -> bool:
    sid = os.environ.get('TWILIO_ACCOUNT_SID')
    token = os.environ.get('TWILIO_AUTH_TOKEN')
    from_number = os.environ.get('TWILIO_FROM_NUMBER')
    if not _twilio_available or not sid or not token or not from_number:
        return False
    try:
        client = TwilioClient(sid, token)
        client.messages.create(body=body, from_=from_number, to=to_number)
        return True
    except Exception as e:
        app.logger.error(f"Twilio send failed: {e}")
        return False

@app.route('/')
def home():
    user_email = session.get('user_email')
    user = None
    medical_profile = None
    profile_exists = False
    last_ambulance = None
    if user_email:
        user = User.query.filter_by(email=user_email).first()
        if user:
            last_ambulance = AmbulanceRequest.query.filter_by(user_email=user_email).order_by(AmbulanceRequest.id.desc()).first()
            medical_profile = MedicalProfile.query.filter_by(user_email=user_email).first()
            profile_exists = bool(medical_profile and medical_profile.emergency_contact)
    total_donors = BloodDonor.query.count()
    return render_template(
        'index.html',
        user=user,
        medical_profile=medical_profile,
        profile_exists=profile_exists,
        last_ambulance=last_ambulance,
        total_donors=total_donors
    )

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        name = request.form['name'].strip()
        email = request.form['email'].strip().lower()
        password = request.form['password']
        address = request.form.get('address') or ''
        age = request.form.get('age')
        blood_group = request.form.get('blood_group') or ''
        emergency_contact = request.form.get('emergency_contact') or ''
        if not validate_username(name):
            flash('Username must only contain letters and numbers.', 'danger')
            return redirect(url_for('signup'))
        if not validate_password(password):
            flash('Password must be at least 8 characters long.', 'danger')
            return redirect(url_for('signup'))
        if not age or not str(age).isdigit() or int(age) < 0:
            flash('Age must be a positive number.', 'danger')
            return redirect(url_for('signup'))
        if not email.endswith('.com'):
            flash('Email must end with .com', 'danger')
            return redirect(url_for('signup'))
        valid_blood_groups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']
        if blood_group and blood_group not in valid_blood_groups:
            flash('Select a valid blood group.', 'danger')
            return redirect(url_for('signup'))
        if User.query.filter_by(email=email).first():
            flash('Email already registered.', 'danger')
            return redirect(url_for('signup'))
        hashed_password = generate_password_hash(password)
        new_user = User(name=name, email=email, password=hashed_password, address=address, age=int(age), blood_group=blood_group)
        db.session.add(new_user)
        db.session.flush()
        existing_profile = MedicalProfile.query.filter_by(user_email=email).first()
        if not existing_profile:
            medical_profile = MedicalProfile(user_email=email, blood_group=blood_group or '', allergies='', emergency_contact=emergency_contact)
            db.session.add(medical_profile)
        db.session.commit()
        session['user_email'] = email
        flash('Account created successfully!', 'success')
        return redirect(url_for('home'))
    return render_template('signup.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form['email'].strip().lower()
        password = request.form['password']
        user = User.query.filter_by(email=email).first()
        if user and check_password_hash(user.password, password):
            session['user_email'] = user.email
            existing_profile = MedicalProfile.query.filter_by(user_email=user.email).first()
            if not existing_profile:
                medical_profile = MedicalProfile(user_email=user.email, blood_group=user.blood_group or '', allergies='', emergency_contact='')
                db.session.add(medical_profile)
                db.session.commit()
            flash(f'Welcome, {user.name}!', 'success')
            return redirect(url_for('home'))
        flash('Invalid email or password', 'danger')
    return render_template('login.html')

@app.route('/logout', methods=['POST'])
def logout():
    session.pop('user_email', None)
    flash('Logged out successfully!', 'success')
    return redirect(url_for('home'))

@app.route('/sos', methods=['POST'])
def sos():
    user_email = session.get('user_email')
    if not user_email:
        return jsonify({"error": "Not logged in"}), 401
    user = User.query.filter_by(email=user_email).first()
    if not user:
        return jsonify({"error": "User not found"}), 404
    medical_profile = MedicalProfile.query.filter_by(user_email=user_email).first()
    contact = medical_profile.emergency_contact if medical_profile else None
    data = request.get_json() or {}
    latitude = data.get('latitude')
    longitude = data.get('longitude')
    location = f"{latitude},{longitude}" if latitude and longitude else "Location not provided"
    timestamp = datetime.utcnow().isoformat()
    message = f"Emergency alert for {user.name} ({user.email}) at {timestamp}. Location: {location}. Please respond immediately."
    status = 'simulated'
    sent = False
    if contact:
        if _twilio_available and os.environ.get('TWILIO_ACCOUNT_SID') and os.environ.get('TWILIO_AUTH_TOKEN') and os.environ.get('TWILIO_FROM_NUMBER'):
            sent = _send_sms_via_twilio(contact, message)
            status = 'sent' if sent else 'failed'
        else:
            app.logger.info(f"SIMULATED SMS to {contact}: {message}")
            status = 'simulated'
            sent = True
    else:
        return jsonify({"error": "No emergency contact configured"}), 400
    try:
        log = SOSLog(user_email=user_email, contact=contact, location=location, message=message, status=status)
        db.session.add(log)
        db.session.commit()
    except SQLAlchemyError as e:
        app.logger.error(f"Failed to log SOS: {e}")
    return jsonify({"message": "SOS processed", "contact": contact, "status": status})

@app.route('/api/user_info')
def api_user_info():
    user_email = session.get('user_email')
    if not user_email:
        return jsonify({"error": "Not logged in"}), 401
    user = User.query.filter_by(email=user_email).first()
    last_ambulance = AmbulanceRequest.query.filter_by(user_email=user_email).order_by(AmbulanceRequest.id.desc()).first()
    total_donors = BloodDonor.query.count()
    return jsonify({"name": user.name,"age": user.age,"blood_group": user.blood_group,"last_ambulance": last_ambulance.location if last_ambulance else "No record","total_donors": total_donors})

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
app.config['UPLOAD_FOLDER'] = 'static/uploads'

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/edit_profile', methods=['POST'])
def edit_profile():
    user_email = session.get('user_email')
    if not user_email: return jsonify({"error": "Not logged in"}), 401
    
    user = User.query.filter_by(email=user_email).first()
    if not user: return jsonify({"error": "User not found"}), 404

    # Handle standard form data
    data = request.form
    user.name = data.get('name', user.name)
    user.address = data.get('address', user.address)
    user.gender = data.get('gender', user.gender)
    user.phone = data.get('phone', user.phone)
    
    age_val = data.get('age')
    if age_val and str(age_val).isdigit(): user.age = int(age_val)

    # Handle File Upload
    if 'profile_pic' in request.files:
        file = request.files['profile_pic']
        if file and allowed_file(file.filename):
            if not os.path.exists(app.config['UPLOAD_FOLDER']):
                os.makedirs(app.config['UPLOAD_FOLDER'])
            
            # Secure filename (simple version)
            ext = file.filename.rsplit('.', 1)[1].lower()
            filename = f"user_{user.id}_{datetime.now().strftime('%Y%m%d%H%M%S')}.{ext}"
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            
            # Save relative path to DB
            user.profile_pic = f"uploads/{filename}"

    # Handle Medical Profile
    medical_profile = MedicalProfile.query.filter_by(user_email=user_email).first()
    if not medical_profile:
        medical_profile = MedicalProfile(user_email=user_email)
        db.session.add(medical_profile)

    medical_profile.blood_group = data.get('blood_group', medical_profile.blood_group)
    medical_profile.emergency_contact = data.get('emergency_contact', medical_profile.emergency_contact)
    medical_profile.allergies = data.get('allergies', medical_profile.allergies)
    medical_profile.medications = data.get('medications', medical_profile.medications)
    medical_profile.chronic_conditions = data.get('chronic_conditions', medical_profile.chronic_conditions)
    medical_profile.surgeries = data.get('surgeries', medical_profile.surgeries)
    
    # Sync top-level blood group for consistency
    user.blood_group = medical_profile.blood_group

    db.session.commit()
    return jsonify({"message": "Profile updated successfully!", "pic": user.profile_pic})

@app.route('/blood_donation', methods=['POST'])
def blood_donation():
    form_type = request.form.get('form_type')
    if form_type == 'donor':
        donor = BloodDonor(name=request.form['name'], blood_group=request.form['blood_group'], contact=request.form['contact'], city=request.form['city'])
        db.session.add(donor)
        db.session.commit()
        flash('Donor registered successfully!', 'success')
    elif form_type == 'request':
        req = BloodRequest(requester_name=request.form['requester_name'], blood_group=request.form['blood_group'], city=request.form['city'], reason=request.form['reason'])
        db.session.add(req)
        db.session.commit()
        flash('Blood request submitted!', 'success')
    return redirect(url_for('home'))

@app.route('/medicine_search', methods=['POST'])
def medicine_search():
    data = request.get_json()
    medicine = (data.get('medicine', '') or '').lower()
    dummy_data = [{"pharmacy": "CityMed Pharmacy", "medicine": "paracetamol"},{"pharmacy": "HealthPlus Store", "medicine": "ibuprofen"},{"pharmacy": "CareWell Pharmacy", "medicine": "amoxicillin"}]
    found = [d for d in dummy_data if medicine in d["medicine"]]
    return jsonify(found if found else {"error": "Medicine not found nearby"})

@app.route('/book_ambulance', methods=['POST'])
def book_ambulance():
    user_email = session.get('user_email')
    if not user_email:
        return jsonify({"error": "You must be logged in to book an ambulance"}), 401
    data = request.get_json()
    lat = data.get('latitude')
    lon = data.get('longitude')
    if not lat or not lon:
        return jsonify({"error": "Location not provided"}), 400
    location_str = f"{lat},{lon}"
    new_request = AmbulanceRequest(user_email=user_email, location=location_str)
    db.session.add(new_request)
    db.session.commit()
    return jsonify({"message": "Ambulance booked successfully!", "eta": "7 mins", "ambulance": "Ambulance A1"})

@app.route('/locations')
def locations():
    data = [
        {'name': 'City Hospital', 'lat': 26.9124, 'lng': 75.7873, 'type': 'hospital'},
        {'name': '24x7 Pharmacy', 'lat': 26.9150, 'lng': 75.7800, 'type': 'pharmacy'},
        {'name': 'Ambulance Service', 'lat': 26.9180, 'lng': 75.7850, 'type': 'ambulance'}
    ]
    return jsonify(data)

@app.route('/api/check_profile')
def check_profile():
    user_email = session.get('user_email')
    profile = MedicalProfile.query.filter_by(user_email=user_email).first() if user_email else None
    return jsonify({"profile_exists": bool(profile)}), 200

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        # Ensure all columns exist
        ensure_table_columns(User)
        ensure_table_columns(MedicalProfile)
        
    app.run(debug=True)
