# 🏠 जनगणना सर्वेक्षण — Census Survey Portal

A beautiful, mobile-friendly census survey web application built with **HTML**, **CSS**, and **JavaScript**, powered by **Supabase** for authentication and data storage.

## ✨ Features

- 🔐 **User Authentication** — Sign up / Sign in with email and password
- 📋 **9-Step Survey Wizard** — All 34 census questions organized into logical sections
- 📱 **Fully Mobile Responsive** — Works perfectly on phones, tablets, and desktops
- 🌙 **Dark/Light Theme** — Toggle between themes with persistence
- 🎨 **Glass-morphism Design** — Modern, beautiful UI with animated background orbs
- 💾 **Supabase Backend** — Secure data storage with Row Level Security (RLS)
- 📊 **My Records** — View all your previous submissions
- ⚡ **Real-time Validation** — Step-by-step form validation with visual feedback

## 📁 File Structure

```
CensusSurvey/
├── index.html           # Main HTML file
├── style.css            # Styles (glass-morphism, responsive, animations)
├── app.js               # Frontend logic & Supabase integration
├── supabase_setup.sql   # Database schema & RLS policies
└── README.md            # This file
```

## 🚀 Setup Instructions

### 1. Create a Supabase Project
- Go to [https://supabase.com](https://supabase.com) and create a new project
- Copy your **Project URL** and **anon public API key**

### 2. Update `app.js`
Open `app.js` and replace the placeholder values at the top:

```javascript
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_KEY = 'YOUR_ANON_PUBLIC_KEY';
```

### 3. Run the SQL Setup
In your Supabase project SQL Editor, run the contents of `supabase_setup.sql` to create:
- The `census_surveys` table
- Row Level Security (RLS) policies
- Performance indexes

### 4. Enable Email Auth
In Supabase Dashboard → Authentication → Providers → Email:
- Make sure **Email** provider is enabled
- Optionally disable **Confirm email** if you want instant access

### 5. Open the App
Simply open `index.html` in any modern browser, or deploy to:
- Netlify
- Vercel
- GitHub Pages
- Any static hosting

## 📋 Survey Questions Covered

| Step | Topic | Questions |
|------|-------|-----------|
| 1 | House Identification | Line No., Building No., Census House No. |
| 2 | House Construction | Floor, Wall, Roof Material |
| 3 | House Usage & Condition | Usage Type, Condition |
| 4 | Family Details | Family Serial, Persons Count, Head Name, Gender, Category |
| 5 | Ownership & Rooms | Ownership, Rooms, Married Couples |
| 6 | Water & Sanitation | Water Source, Availability, Light, Toilet, Drainage, Bathing |
| 7 | Kitchen & Fuel | Kitchen & Gas, Cooking Fuel |
| 8 | Assets & Facilities | Radio, TV, Internet, Laptop, Phone, Cycle/Scooter, Car |
| 9 | Food & Contact | Main Grain, Mobile Number |

## 🛡️ Security

- **Row Level Security (RLS)** ensures users can only see their own data
- All authentication is handled securely by Supabase Auth
- No sensitive data is stored in localStorage

## 📱 Mobile Tips

- The app is a **PWA-ready** single-page application
- Add to home screen for a native app-like experience
- All form controls are touch-optimized with large tap targets

## 🎨 Design Credits

Design inspired by the existing JNV Attendance Portal with:
- Animated gradient orbs
- Glass-morphism cards
- Smooth spring animations
- Responsive grid layouts
