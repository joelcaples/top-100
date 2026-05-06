# Account Menu Feature

## Overview

A new account icon and dropdown menu have been added to the header, providing users with quick access to account settings and information.

## Features

### Account Icon
- Located in the top-right corner of the hero header (next to the sign-in button)
- Displays a user profile icon
- Only visible when a user is authenticated
- Styled with the deco button aesthetic (gold/black theme)
- Shows as active state when the menu is open

### Account Menu Dropdown
When clicked, the account icon opens a dropdown panel containing:

#### User Information Section
- **Username**: Displays the user's current username
- **OAuth Provider**: Shows the authentication provider (e.g., "GitHub", "Local")

#### Actions Section
- **Change Username**: Opens the username modal to allow users to update their username
  - Closes the account menu when clicked
  - Shows the username setup modal
  - Updates both the modal and menu display after successful change
- **Sign Out**: Direct link to sign out
  - Uses the OAuth provider's logout URL
  - Redirects to home page after logout

### Menu Behavior
- Closes when clicking the close button (X)
- Closes when clicking the backdrop/outside the menu
- Shows loading state "—" if data isn't available
- Updates in real-time when username is changed via the modal

## Technical Implementation

### HTML
- Account icon button: `#accountMenuBtn` with profile SVG icon
- Account menu container: `#accountMenu` with fixed positioning
- Menu elements with data attributes for close handling: `[data-account-close]`
- Accessible ARIA attributes: `aria-expanded`, `aria-controls`, `aria-label`

### CSS
New style classes added:
- `.account-icon-btn` - Button styling (2.2rem square, deco design)
- `.account-menu` - Fixed position dropdown with backdrop blur
- `.account-menu__panel` - Panel styling with gradient background
- `.account-menu__header` - Header with title and close button
- `.account-menu__content` - Scrollable content area
- `.account-menu__section` - Information sections (username, provider)
- `.account-menu__action` - Action buttons (change username, sign out)

### JavaScript
New functions in `app.js`:
```javascript
showAccountMenu()          // Opens the account menu
closeAccountMenu()         // Closes the account menu
updateAccountMenuDisplay() // Populates menu with user data
```

Event handlers:
- Account icon click → opens menu
- Backdrop/close button click → closes menu
- Change username click → closes menu + opens username modal
- Logout link → standard navigation

### API Integration
Uses existing `/api/me` endpoint which now returns:
```json
{
  "isAuthenticated": boolean,
  "displayName": string,
  "username": string | null,
  "loginUrl": string,
  "logoutUrl": string,
  "authProvider": string  // "github", "local", etc.
}
```

## User Flow

### First Time Logged In (No Username)
1. User clicks GitHub OAuth sign-in
2. Redirected back to app
3. Account icon appears in header
4. Username modal displays automatically
5. User sets username
6. Account menu shows username and provider

### Returning User
1. User clicks GitHub OAuth sign-in
2. Account icon appears immediately
3. Clicking icon shows menu with current username and provider
4. Can change username via "Change Username" action

### Changing Username
1. Click account icon to open menu
2. Click "Change Username"
3. Menu closes, username modal opens
4. Enter new username
5. On success, account menu updates to show new username

## Styling Notes

Matches the existing deco aesthetic:
- Gold/black color scheme (`--gold: #b79354`)
- Cinzel font for titles and labels
- Gradient backgrounds with subtle borders
- Smooth transitions and hover effects
- Coral accent color for logout (#de988a)

## Accessibility

- ARIA labels on all interactive elements
- Keyboard navigable (buttons and links)
- Backdrop click support for menu dismissal
- Clear visual feedback on hover and active states
- Semantic HTML structure

## Browser Support

Tested on:
- Chrome/Chromium (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

Uses standard CSS Grid, Flexbox, and backdrop-filter (with fallback).
