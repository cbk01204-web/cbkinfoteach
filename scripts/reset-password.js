const { execSync } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('==================================================');
console.log('   CBK HRMS Local Auth Password Reset Utility');
console.log('==================================================\n');

// Check for local service-account.json in root folder
const serviceAccountPath = path.join(__dirname, '../service-account.json');
let useAdminSdk = false;
if (fs.existsSync(serviceAccountPath)) {
    useAdminSdk = true;
    console.log('✓ Found local service-account.json. Using Firebase Admin SDK.\n');
} else {
    console.log('ℹ No service-account.json found. Falling back to Firebase CLI.\n');
}

rl.question('Enter the email address of the account to reset: ', (email) => {
    rl.question('Enter the new password (at least 6 characters): ', (password) => {
        email = email.trim();
        password = password.trim();

        if (!email || !password) {
            console.error('Error: Email and password fields cannot be empty.');
            rl.close();
            return;
        }

        if (password.length < 6) {
            console.error('Error: Password must be at least 6 characters.');
            rl.close();
            return;
        }

        if (useAdminSdk) {
            try {
                const admin = require('firebase-admin');
                const serviceAccount = require(serviceAccountPath);
                
                if (admin.apps.length === 0) {
                    admin.initializeApp({
                        credential: admin.credential.cert(serviceAccount)
                    });
                }

                admin.auth().getUserByEmail(email)
                    .then((userRecord) => {
                        return admin.auth().updateUser(userRecord.uid, { password: password });
                    })
                    .then((userRecord) => {
                        console.log(`\n✓ Password reset successfully for UID: ${userRecord.uid}!`);
                        rl.close();
                    })
                    .catch((err) => {
                        console.error('\nAdmin SDK reset failed:', err.message);
                        rl.close();
                    });
            } catch (err) {
                console.error('\nError initializing firebase-admin SDK. Make sure it is installed (run: npm install firebase-admin).');
                console.error('Details:', err.message);
                rl.close();
            }
        } else {
            // Fallback to Firebase CLI with explicit project flag
            try {
                console.log('\nFetching user accounts from Firebase CLI...');
                const listOutput = execSync('firebase auth:users:list --project cbkinfotech', { encoding: 'utf8' });
                
                const lines = listOutput.split('\n');
                let uid = null;
                
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(email.toLowerCase())) {
                        const parts = lines[i].split('│').map(p => p.trim());
                        if (parts.length >= 3) {
                            uid = parts[1];
                            break;
                        }
                    }
                }

                if (!uid) {
                    console.error(`\nError: User account with email "${email}" was not found in the Firebase project.`);
                    rl.close();
                    return;
                }

                console.log(`Found matching user UID: ${uid}`);
                console.log(`Updating password to "${password}"...`);
                
                execSync(`firebase auth:users:update ${uid} --password ${password} --project cbkinfotech`);
                console.log('\n✓ Password reset successfully! You can now log into the application with the new password.');
            } catch (err) {
                console.error('\nFailed to execute Firebase CLI. Please verify the following:');
                console.error('1. Firebase CLI tools are installed (run: npm install -g firebase-tools)');
                console.error('2. You are signed in to Firebase (run: firebase login)');
                console.error('3. The active project matches your database (run: firebase use cbkinfotech)');
                console.error('\nExecution error details:', err.message);
            }
            rl.close();
        }
    });
});
