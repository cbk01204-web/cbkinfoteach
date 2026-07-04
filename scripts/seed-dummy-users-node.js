const fs = require('fs');
const path = require('path');

const serviceAccountPath = path.join(__dirname, '../service-account.json');

console.log('==================================================');
console.log('   CBK HRMS 15 Dummy Accounts Seeder (Node.js)');
console.log('==================================================\n');

if (!fs.existsSync(serviceAccountPath)) {
    console.error('Error: service-account.json not found in the project root.');
    console.log('To seed 15 dummy accounts (CBK001 - CBK015) via terminal:');
    console.log('1. Place your Firebase Service Account JSON key as "service-account.json" in the root directory.');
    console.log('2. Run: npm install firebase-admin');
    console.log('3. Run: node scripts/seed-dummy-users-node.js\n');
    console.log('--------------------------------------------------');
    console.log('✓ ALTERNATIVE (EASIER):');
    console.log('Simply open the local HTML seeder page in your browser and click "Start Seeding":');
    console.log('http://127.0.0.1:5501/CBK-HRMS/seed-dummy-users.html\n');
    process.exit(1);
}

const admin = require('firebase-admin');
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const auth = admin.auth();

async function seed() {
    const password = 'password123';
    let successCount = 0;
    
    for (let i = 1; i <= 15; i++) {
        const idStr = String(i).padStart(3, '0');
        const email = `cbk${idStr}@cbkinfotech.com`;
        const empId = `CBK${idStr}`;
        const fullName = `Employee ${idStr}`;
        
        console.log(`[${i}/15] Creating account for ${email}...`);
        
        try {
            let uid;
            try {
                // Check if user already exists in Firebase Auth
                const existingUser = await auth.getUserByEmail(email);
                uid = existingUser.uid;
                console.log(`  - Auth user already exists (UID: ${uid}). Updating password...`);
                await auth.updateUser(uid, { password: password });
            } catch (authErr) {
                if (authErr.code === 'auth/user-not-found') {
                    // Create new Auth User
                    const userRecord = await auth.createUser({
                        email: email,
                        password: password,
                        displayName: fullName
                    });
                    uid = userRecord.uid;
                    console.log(`  - Created new Auth user (UID: ${uid})`);
                } else {
                    throw authErr;
                }
            }
            
            // Set users doc in Firestore
            await db.collection('users').doc(uid).set({
                email: email,
                role: 'employee',
                fullName: fullName,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            
            // Set employees doc in Firestore
            await db.collection('employees').doc(uid).set({
                uid: uid,
                email: email,
                firstName: 'Employee',
                lastName: idStr,
                empId: empId,
                role: 'employee',
                designation: 'Software Engineer',
                department: 'Engineering',
                phone: `123-456-7${idStr}`,
                joiningDate: new Date().toISOString().split('T')[0],
                salary: 50000,
                status: 'Active',
                tempPassword: password,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            
            successCount++;
            console.log(`  ✓ Successfully seeded record for ${email}`);
        } catch (err) {
            console.error(`  ✗ Failed for ${email}:`, err.message);
        }
    }
    
    console.log(`\n==================================================`);
    console.log(`Seeding complete. Successfully registered ${successCount}/15 accounts.`);
    console.log(`==================================================`);
}

seed();
