const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('==================================================');
console.log('   CBK HRMS Local Auth Password Reset Utility');
console.log('==================================================\n');

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

        try {
            console.log('\nFetching user accounts from Firebase CLI...');
            const listOutput = execSync('firebase auth:users:list', { encoding: 'utf8' });
            
            // Search for email inside table structure of firebase auth:users:list
            const lines = listOutput.split('\n');
            let uid = null;
            
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(email.toLowerCase())) {
                    // Format is: │ uid │ email │ ...
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
            
            execSync(`firebase auth:users:update ${uid} --password ${password}`);
            console.log('\n✓ Password reset successfully! You can now log into the application with the new password.');
        } catch (err) {
            console.error('\nFailed to execute Firebase CLI. Please verify the following:');
            console.error('1. Firebase CLI tools are installed (run: npm install -g firebase-tools)');
            console.error('2. You are signed in to Firebase (run: firebase login)');
            console.error('3. The active project matches your database (run: firebase use cbkinfotech)');
            console.error('\nExecution error details:', err.message);
        }
        rl.close();
    });
});
