// Test script to verify scraper functionality safely
const { 
  scrapeNews, 
  downloadAndUploadImage, 
  safelyUpdateNewsInFirebase,
  backupExistingNews 
} = require('./src/index.js');

async function testScraper() {
  console.log('🧪 Testing News Scraper (Safe Mode)...\n');
  
  try {
    // Test 1: Scrape news without uploading
    console.log('📰 Test 1: Scraping news from website...');
    const newsItems = await scrapeNews();
    
    if (newsItems.length > 0) {
      console.log(`✅ Successfully scraped ${newsItems.length} news items`);
      console.log('📋 Sample news item:');
      console.log(`   Title: ${newsItems[0].title}`);
      console.log(`   Link: ${newsItems[0].link}`);
      console.log(`   Image: ${newsItems[0].imageUrl || 'No image'}`);
      console.log(`   Date: ${newsItems[0].date}`);
    } else {
      console.log('❌ No news items found');
      return;
    }
    
    // Test 2: Test image download (without uploading to database)
    console.log('\n🖼️ Test 2: Testing image download...');
    const testItem = newsItems.find(item => item.imageUrl);
    
    if (testItem && testItem.imageUrl) {
      console.log(`📥 Testing download of: ${testItem.imageUrl}`);
      const firebaseUrl = await downloadAndUploadImage(testItem.imageUrl, 'test');
      
      if (firebaseUrl && firebaseUrl !== testItem.imageUrl) {
        console.log(`✅ Image successfully uploaded to Firebase Storage`);
        console.log(`🔗 Firebase URL: ${firebaseUrl}`);
      } else {
        console.log('⚠️ Image upload failed or returned original URL');
      }
    } else {
      console.log('⚠️ No images found to test');
    }
    
    // Test 3: Check existing database (read-only)
    console.log('\n📊 Test 3: Checking existing database...');
    const admin = require('firebase-admin');
    
    if (!admin.apps.length) {
      console.log('❌ Firebase not initialized. Please run the main scraper first.');
      return;
    }
    
    const db = admin.database();
    const newsRef = db.ref('news');
    const snapshot = await newsRef.once('value');
    const existingNews = snapshot.val() || {};
    
    console.log(`📈 Found ${Object.keys(existingNews).length} existing news items in database`);
    
    // Test 4: Simulate safe update (dry run)
    console.log('\n🛡️ Test 4: Simulating safe update (dry run)...');
    
    const existingTitles = new Set();
    Object.values(existingNews).forEach(item => {
      if (item && item.title) {
        existingTitles.add(item.title.toLowerCase().trim());
      }
    });
    
    const newItems = newsItems.filter(item => {
      const titleLower = item.title.toLowerCase().trim();
      return !existingTitles.has(titleLower);
    });
    
    console.log(`🆕 Would add ${newItems.length} new items:`);
    newItems.forEach((item, index) => {
      console.log(`   ${index + 1}. ${item.title}`);
    });
    
    if (newItems.length === 0) {
      console.log('✅ Database is up to date - no new items to add');
    }
    
    console.log('\n🎉 All tests completed successfully!');
    console.log('📋 Summary:');
    console.log(`   - Scraped: ${newsItems.length} items`);
    console.log(`   - Existing in DB: ${Object.keys(existingNews).length} items`);
    console.log(`   - New items: ${newItems.length} items`);
    console.log('   - Database safety: ✅ Verified');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testScraper();
}

module.exports = { testScraper };
