# OrbitQA - New Features Guide

## Pods
Create pods for instant YouTube without Gmail sessions.

### Usage
1. Go to **Pods** in the sidebar
2. Enter a **Pod name** (or leave blank for auto-generated)
3. Select **Device type**: Desktop, Android, or iOS
4. Set **How many** profiles per device (e.g., 20)
5. Select **Country** (US, GB, CA, AU, NG, IN)
6. Click **Create Pod** - random device profiles will be generated and assigned to the selected country

Each pod contains a list of generated profiles ready for use.

## Warmer
Warm profiles by having them visit Google, search random topics, and save cookies/history.

### Usage
1. Go to **Warmer** in the sidebar
2. **Add topics** in the Topics section (defaults to "investments"). Add/remove as needed.
3. Click **RUN - Warm with POD profiles** to start warming. Profiles will:
   - Visit Google and search random things from your topic list
   - Save cookies and history in each profile
   - When visiting websites, use history from the profile
4. On YouTube, select the **POD profile** and target specific videos

### Gmail/Account Assignment
1. In the **Assign Gmail accounts** section, enter the Gmail account and purpose
2. Click **Assign**
3. Account profiles store authorized sessions - auto-login will fill appropriate information
4. **Saved accounts remain logged in** and are not logged out automatically

## Notes
- **Manual proxies**: Always check for manual proxy settings - they won't be changed automatically
- **Session persistence**: Any saved account should remain logged in; sessions are preserved
- **Dashboard**: View total counts for runs, proxies, cookies, streaming accounts, and social accounts
- **POD profiles**: Use with Warmer for coordinated warming, and select POD profile when running YouTube tasks
