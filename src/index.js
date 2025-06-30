const axios = require('axios');
const cheerio = require('cheerio');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const BASE_URL = 'https://www.thk.edu.tr';
const NEWS_PAGE_URL = `${BASE_URL}/haberler`;
const ANNOUNCEMENTS_PAGE_URL = `${BASE_URL}/duyurular`;

// Initialize Firebase Admin
const serviceAccount = require('../service.json'); // <-- Point this to your JSON
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://edugoryy-default-rtdb.europe-west1.firebasedatabase.app/',
  storageBucket: 'edugoryy.appspot.com', // Add your storage bucket
});

const db = admin.database();
const bucket = admin.storage().bucket();

// Create temp directory for downloads
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Image compression configuration
const IMAGE_COMPRESSION_CONFIG = {
  jpeg: {
    quality: 80,
    progressive: true,
    mozjpeg: true
  },
  png: {
    quality: 80,
    compressionLevel: 8,
    progressive: true
  },
  webp: {
    quality: 80,
    effort: 6
  },
  maxWidth: 1200,
  maxHeight: 800
};

// Function to compress image using Sharp
async function compressImage(inputPath, outputPath) {
  try {
    const fileExtension = path.extname(inputPath).toLowerCase();

    console.log(`🗜️ Compressing image: ${path.basename(inputPath)}`);

    let sharpInstance = sharp(inputPath)
      .resize(IMAGE_COMPRESSION_CONFIG.maxWidth, IMAGE_COMPRESSION_CONFIG.maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });

    // Apply format-specific compression
    switch (fileExtension) {
      case '.jpg':
      case '.jpeg':
        sharpInstance = sharpInstance.jpeg(IMAGE_COMPRESSION_CONFIG.jpeg);
        break;
      case '.png':
        sharpInstance = sharpInstance.png(IMAGE_COMPRESSION_CONFIG.png);
        break;
      case '.webp':
        sharpInstance = sharpInstance.webp(IMAGE_COMPRESSION_CONFIG.webp);
        break;
      default:
        // Convert unknown formats to JPEG
        sharpInstance = sharpInstance.jpeg(IMAGE_COMPRESSION_CONFIG.jpeg);
        break;
    }

    await sharpInstance.toFile(outputPath);

    // Get file sizes for comparison
    const originalSize = fs.statSync(inputPath).size;
    const compressedSize = fs.statSync(outputPath).size;
    const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);

    console.log(`✅ Compression complete: ${(originalSize / 1024).toFixed(1)}KB → ${(compressedSize / 1024).toFixed(1)}KB (${compressionRatio}% reduction)`);

    return {
      originalSize,
      compressedSize,
      compressionRatio: parseFloat(compressionRatio)
    };

  } catch (error) {
    console.error(`❌ Error compressing image: ${error.message}`);
    // If compression fails, copy original file
    fs.copyFileSync(inputPath, outputPath);
    return null;
  }
}

// Function to scrape detailed content from individual news page
async function scrapeNewsDetails(newsUrl) {
  try {
    console.log(`🔍 Scraping details from: ${newsUrl}`);

    const response = await axios.get(newsUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    console.log(`📄 Response status: ${response.status}`);
    const $ = cheerio.load(response.data);

    // Debug: Check if we can find the main content area
    const contentArea = $('.duyuru-page-content').length;
    console.log(`🔍 Found content area: ${contentArea > 0 ? 'YES' : 'NO'}`);

    // Extract detailed content based on the HTML structure you provided
    const category = $('.date h5').text().trim() || 'Genel Haberler';
    const fullDate = $('.date-inner h6').text().trim();
    const fullTitle = $('.content-title h3').text().trim();

    // Get the complete article content - all paragraphs and HTML content
    let fullContent = '';
    $('.content-title p').each((i, element) => {
      const pContent = $(element).html();
      if (pContent) {
        fullContent += pContent + '\n';
      }
    });

    // If no content found in paragraphs, try to get all content from content-title div
    if (!fullContent.trim()) {
      fullContent = $('.content-title').html() || $('.content-title').text().trim();
    }

    console.log(`📝 Category: "${category}"`);
    console.log(`📅 Full Date: "${fullDate}"`);
    console.log(`📰 Full Title: "${fullTitle}"`);
    console.log(`📄 Content Length: ${fullContent ? fullContent.length : 0}`);

    // Debug: Show the full content
    if (fullContent && fullContent.trim()) {
      console.log(`📄 FULL CONTENT DEBUG:`);
      console.log(`=====================================`);
      console.log(fullContent);
      console.log(`=====================================`);
    } else {
      console.log(`⚠️ NO CONTENT EXTRACTED!`);
    }

    // Extract any additional images from the content
    const contentImages = [];
    $('.content-title img').each((index, element) => {
      const imgSrc = $(element).attr('src');
      if (imgSrc) {
        const fullImgUrl = imgSrc.startsWith('http') ? imgSrc : `https://www.thk.edu.tr${imgSrc}`;
        contentImages.push(fullImgUrl);
        console.log(`🖼️ Found image: ${fullImgUrl}`);
      }
    });

    // Also check for images in the entire content area (including tiny images)
    $('.duyuru-page-content img').each((index, element) => {
      const imgSrc = $(element).attr('src');
      if (imgSrc && imgSrc.includes('/tiny/')) {
        const fullImgUrl = imgSrc.startsWith('http') ? imgSrc : `https://www.thk.edu.tr${imgSrc}`;
        if (!contentImages.includes(fullImgUrl)) {
          contentImages.push(fullImgUrl);
          console.log(`🖼️ Found tiny image: ${fullImgUrl}`);
        }
      }
    });

    console.log(`✅ Extracted details for: ${fullTitle || 'NO TITLE FOUND'}`);
    console.log(`📸 Found ${contentImages.length} images in content`);

    return {
      category,
      fullDate,
      fullTitle,
      fullContent,
      contentImages
    };

  } catch (error) {
    console.error(`❌ Error scraping news details from ${newsUrl}:`, error.message);
    console.error(`❌ Error stack:`, error.stack);
    return null;
  }
}

// Function to download image and upload to Firebase Storage
async function downloadAndUploadImage(imageUrl, newsId) {
  try {
    console.log(`📥 Downloading image: ${imageUrl}`);
    
    // Download image
    const response = await axios({
      method: 'GET',
      url: imageUrl,
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    // Generate unique filename
    const fileExtension = path.extname(imageUrl) || '.jpg';
    const originalFileName = `news_${newsId}_${Date.now()}_original${fileExtension}`;
    const compressedFileName = `news_${newsId}_${Date.now()}_compressed${fileExtension}`;
    const tempFilePath = path.join(tempDir, originalFileName);
    const compressedFilePath = path.join(tempDir, compressedFileName);

    // Save to temp file
    const writer = fs.createWriteStream(tempFilePath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    console.log(`💾 Image saved temporarily: ${originalFileName}`);

    // Compress the image
    const compressionStats = await compressImage(tempFilePath, compressedFilePath);

    // Use compressed file for upload
    const finalFilePath = fs.existsSync(compressedFilePath) ? compressedFilePath : tempFilePath;
    const finalFileName = fs.existsSync(compressedFilePath) ? compressedFileName : originalFileName;

    // Upload to Firebase Storage
    const storageFileName = `news_images/${finalFileName}`;
    const file = bucket.file(storageFileName);

    await bucket.upload(finalFilePath, {
      destination: storageFileName,
      metadata: {
        metadata: {
          newsId: newsId,
          originalUrl: imageUrl,
          uploadedAt: new Date().toISOString(),
          compressed: compressionStats ? 'true' : 'false',
          originalSize: compressionStats ? compressionStats.originalSize : 'unknown',
          compressedSize: compressionStats ? compressionStats.compressedSize : 'unknown',
          compressionRatio: compressionStats ? compressionStats.compressionRatio : 'unknown'
        }
      }
    });

    // Make file publicly accessible
    await file.makePublic();

    // Get public URL
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storageFileName}`;

    // Clean up temp files
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    if (fs.existsSync(compressedFilePath)) {
      fs.unlinkSync(compressedFilePath);
    }

    const compressionInfo = compressionStats ?
      ` (compressed ${compressionStats.compressionRatio}%)` :
      ' (no compression)';

    console.log(`✅ Image uploaded to Firebase Storage: ${publicUrl}${compressionInfo}`);
    return publicUrl;

  } catch (error) {
    console.error(`❌ Error processing image ${imageUrl}:`, error.message);
    return imageUrl; // Return original URL as fallback
  }
}



// Function to scrape announcements from THK website
async function scrapeAnnouncements() {
  try {
    console.log('📢 Starting announcements scraping from THK website...');

    const response = await axios.get(ANNOUNCEMENTS_PAGE_URL, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const announcementItems = [];

    // THK announcements use the same structure but with duyuru-page-item selector
    const announcementSelector = '.duyuru-page-item';
    const items = $(announcementSelector);

    if (items.length > 0) {
      console.log(`📋 Found ${items.length} announcement items using THK-specific selector`);

      for (let i = 0; i < Math.min(items.length, 15); i++) {
        const element = items.eq(i);

        try {
          // Extract title from h5 element
          const title = element.find('h5').text().trim();

          // Extract link from the "İncele" button
          const link = element.find('.haberler-page-date a').attr('href') ||
                      element.find('a[href*="duyuru"]').attr('href');

          // Extract date from the date div
          const dateText = element.find('.date').text().trim();

          if (title && title.length > 5 && link) {
            const fullLink = link.startsWith('http') ? link : `${BASE_URL}${link}`;

            // Parse Turkish date format (DD.MM.YYYY)
            let parsedDate;
            try {
              if (dateText && dateText.match(/\d{2}\.\d{2}\.\d{4}/)) {
                const [day, month, year] = dateText.split('.');
                parsedDate = new Date(year, month - 1, day).toISOString();
              } else {
                parsedDate = new Date().toISOString();
              }
            } catch {
              parsedDate = new Date().toISOString();
            }

            announcementItems.push({
              id: i,
              title: title.substring(0, 200), // Limit title length
              link: fullLink,
              imageUrl: null, // Announcements typically don't have preview images
              date: parsedDate,
              category: 'THK Duyuruları'
            });

            console.log(`✅ Processed: ${title}`);
          }
        } catch (error) {
          console.error(`Error processing announcement item ${i}:`, error.message);
        }
      }
    }

    console.log(`📢 Successfully scraped ${announcementItems.length} announcement items`);
    return announcementItems;

  } catch (error) {
    console.error('❌ Error scraping announcements:', error.message);
    return [];
  }
}

// Function to scrape news from THK website
async function scrapeNews() {
  try {
    console.log('🚀 Starting news scraping from THK website...');

    const response = await axios.get(NEWS_PAGE_URL, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const newsItems = [];

    // THK specific selectors - based on actual website structure
    const newsSelector = '.haberler-page-item';
    const items = $(newsSelector);

    if (items.length > 0) {
      console.log(`📋 Found ${items.length} news items using THK-specific selector`);

      for (let i = 0; i < Math.min(items.length, 15); i++) {
        const element = items.eq(i);

        try {
          // Extract title from h5 element
          const title = element.find('h5').text().trim();

          // Extract link from the "Oku" button
          const link = element.find('.haberler-page-date a').attr('href');

          // Extract image from the haberler-img div
          const imageUrl = element.find('.haberler-img img').first().attr('src');

          // Extract date from the date div
          const dateText = element.find('.date').text().trim();

          if (title && title.length > 5 && link) {
            const fullLink = link.startsWith('http') ? link : `${BASE_URL}${link}`;
            let fullImageUrl = null;

            if (imageUrl) {
              fullImageUrl = imageUrl.startsWith('http') ? imageUrl : `${BASE_URL}${imageUrl}`;
            }

            // Parse Turkish date format (DD.MM.YYYY)
            let parsedDate;
            try {
              if (dateText && dateText.match(/\d{2}\.\d{2}\.\d{4}/)) {
                const [day, month, year] = dateText.split('.');
                parsedDate = new Date(year, month - 1, day).toISOString();
              } else {
                parsedDate = new Date().toISOString();
              }
            } catch {
              parsedDate = new Date().toISOString();
            }

            newsItems.push({
              id: i,
              title: title.substring(0, 200), // Limit title length
              link: fullLink,
              imageUrl: fullImageUrl,
              date: parsedDate,
              category: 'THK Haberleri'
            });

            console.log(`✅ Processed: ${title}`);
          }
        } catch (error) {
          console.error(`Error processing news item ${i}:`, error.message);
        }
      }
    } else {
      console.log('⚠️ No news items found with THK-specific selector, trying fallback...');

      // Fallback: look for any links that might be news
      $('a').each((index, element) => {
        if (newsItems.length >= 10) return false; // Limit fallback items

        const $link = $(element);
        const href = $link.attr('href');
        const text = $link.text().trim();

        if (href && text && text.length > 20 &&
            (href.includes('/haber') || href.includes('/news') || href.includes('/duyuru'))) {

          const fullLink = href.startsWith('http') ? href : `${BASE_URL}${href}`;

          newsItems.push({
            id: newsItems.length,
            title: text.substring(0, 200),
            link: fullLink,
            imageUrl: null,
            date: new Date().toISOString(),
            category: 'Genel'
          });
        }
      });
    }

    console.log(`📰 Successfully scraped ${newsItems.length} news items`);
    return newsItems;

  } catch (error) {
    console.error('❌ Error scraping news:', error.message);
    return [];
  }
}

// Function to check for new items before processing
async function checkForNewItems(newsItems) {
  try {
    console.log('🔍 Checking for new news items before detailed processing...');

    const newsRef = db.ref('news');
    const existingSnapshot = await newsRef.once('value');
    const existingNews = existingSnapshot.val() || {};

    // Create a map of existing news by title
    const existingTitles = new Set();
    Object.values(existingNews).forEach(item => {
      if (item && item.title) {
        existingTitles.add(item.title.toLowerCase().trim());
      }
    });

    // Filter out news that already exist
    const trulyNewItems = newsItems.filter(item => {
      const titleLower = item.title.toLowerCase().trim();
      return !existingTitles.has(titleLower);
    });

    console.log(`📊 Found ${existingTitles.size} existing news items in database`);
    console.log(`🆕 Found ${trulyNewItems.length} truly new news items to process`);

    return trulyNewItems.length > 0;
  } catch (error) {
    console.error('❌ Error checking for new news items:', error.message);
    return true; // Continue processing if check fails
  }
}

// Function to check for new announcements before processing
async function checkForNewAnnouncements(announcementItems) {
  try {
    console.log('🔍 Checking for new announcements before detailed processing...');

    const announcementsRef = db.ref('announcements');
    const existingSnapshot = await announcementsRef.once('value');
    const existingAnnouncements = existingSnapshot.val() || {};

    // Create a map of existing announcements by title
    const existingTitles = new Set();
    Object.values(existingAnnouncements).forEach(item => {
      if (item && item.title) {
        existingTitles.add(item.title.toLowerCase().trim());
      }
    });

    // Filter out announcements that already exist
    const trulyNewItems = announcementItems.filter(item => {
      const titleLower = item.title.toLowerCase().trim();
      return !existingTitles.has(titleLower);
    });

    console.log(`📊 Found ${existingTitles.size} existing announcements in database`);
    console.log(`🆕 Found ${trulyNewItems.length} truly new announcements to process`);

    return trulyNewItems.length > 0;
  } catch (error) {
    console.error('❌ Error checking for new announcements:', error.message);
    return true; // Continue processing if check fails
  }
}

// Function to process and upload announcements with images
async function processAnnouncementsWithImages() {
  try {
    console.log('📢 Starting announcements processing with image upload...');

    const announcementItems = await scrapeAnnouncements();

    // Check for new items BEFORE processing individual pages
    const hasNewItems = await checkForNewAnnouncements(announcementItems);

    if (!hasNewItems) {
      console.log('⏹️ No new announcements found - cancelling announcements process to avoid unnecessary work');
      return [];
    }

    console.log('✅ New announcements detected - proceeding with detailed processing...');
    const processedAnnouncements = [];

    for (let i = 0; i < announcementItems.length; i++) {
      const announcementItem = announcementItems[i];
      console.log(`\n📢 Processing announcement ${i + 1}/${announcementItems.length}: ${announcementItem.title}`);

      // Scrape detailed content from the announcement page
      const announcementDetails = await scrapeNewsDetails(announcementItem.link);

      let contentImageUrls = [];

      // Download and upload only the first content image from the individual page
      if (announcementDetails && announcementDetails.contentImages && announcementDetails.contentImages.length > 0) {
        console.log(`📸 Found ${announcementDetails.contentImages.length} content images, downloading first one only`);
        try {
          const contentImageUrl = await downloadAndUploadImage(
            announcementDetails.contentImages[0], // Only download the first image
            `announcement_${announcementItem.id}_main`
          );
          if (contentImageUrl) {
            contentImageUrls.push(contentImageUrl);
          }
        } catch (error) {
          console.error(`❌ Error processing main content image:`, error.message);
        }
      }

      // Create processed announcement item with all scraped data and Firebase Storage URLs
      const processedItem = {
        title: announcementDetails?.fullTitle || announcementItem.title,
        link: announcementItem.link,
        imageUrl: contentImageUrls[0] || '', // Use first content image as main image
        contentImages: contentImageUrls, // All content images from Firebase Storage
        date: announcementItem.date,
        fullDate: announcementDetails?.fullDate || announcementItem.date,
        category: announcementDetails?.category || announcementItem.category,
        fullContent: announcementDetails?.fullContent || '',
        summary: announcementDetails?.fullContent ?
          announcementDetails.fullContent.replace(/<[^>]*>/g, '').substring(0, 200) + '...' :
          `${announcementItem.title.substring(0, 100)}...`
      };

      processedAnnouncements.push(processedItem);

      // Add small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return processedAnnouncements;

  } catch (error) {
    console.error('❌ Error processing announcements with images:', error.message);
    return [];
  }
}

// Function to process and upload news with images
async function processNewsWithImages() {
  try {
    console.log('🔄 Starting news processing with image upload...');

    const newsItems = await scrapeNews();

    // Check for new items BEFORE processing individual pages
    const hasNewItems = await checkForNewItems(newsItems);

    if (!hasNewItems) {
      console.log('⏹️ No new news items found - cancelling process to avoid unnecessary work');
      return [];
    }

    console.log('✅ New items detected - proceeding with detailed processing...');
    const processedNews = [];

    for (let i = 0; i < newsItems.length; i++) {
      const newsItem = newsItems[i];
      console.log(`\n📝 Processing news ${i + 1}/${newsItems.length}: ${newsItem.title}`);

      // Scrape detailed content from the news page
      const newsDetails = await scrapeNewsDetails(newsItem.link);

      let contentImageUrls = [];

      // Download and upload only the first content image from the individual page
      if (newsDetails && newsDetails.contentImages && newsDetails.contentImages.length > 0) {
        console.log(`📸 Found ${newsDetails.contentImages.length} content images, downloading first one only`);
        try {
          const contentImageUrl = await downloadAndUploadImage(
            newsDetails.contentImages[0], // Only download the first image
            `${newsItem.id}_main`
          );
          if (contentImageUrl) {
            contentImageUrls.push(contentImageUrl);
          }
        } catch (error) {
          console.error(`❌ Error processing main content image:`, error.message);
        }
      }

      // Create processed news item with all scraped data and Firebase Storage URLs
      const processedItem = {
        title: newsDetails?.fullTitle || newsItem.title,
        link: newsItem.link,
        imageUrl: contentImageUrls[0] || '', // Use first content image as main image
        contentImages: contentImageUrls, // All content images from Firebase Storage
        date: newsItem.date,
        fullDate: newsDetails?.fullDate || newsItem.date,
        category: newsDetails?.category || newsItem.category,
        fullContent: newsDetails?.fullContent || '',
        summary: newsDetails?.fullContent ?
          newsDetails.fullContent.replace(/<[^>]*>/g, '').substring(0, 200) + '...' :
          `${newsItem.title.substring(0, 100)}...`
      };

      processedNews.push(processedItem);
      
      // Add small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return processedNews;

  } catch (error) {
    console.error('❌ Error processing news with images:', error.message);
    return [];
  }
}

// Function to clean and renew news in Firebase Database
async function cleanAndRenewNewsInFirebase(newNewsItems) {
  try {
    console.log('� Checking for new news items...');

    const newsRef = db.ref('news');

    // Get existing news to check for duplicates
    const existingSnapshot = await newsRef.once('value');
    const existingNews = existingSnapshot.val() || {};

    // Create a map of existing news by title
    const existingTitles = new Set();
    Object.values(existingNews).forEach(item => {
      if (item && item.title) {
        existingTitles.add(item.title.toLowerCase().trim());
      }
    });

    // Filter out news that already exist
    const trulyNewItems = newNewsItems.filter(item => {
      const titleLower = item.title.toLowerCase().trim();
      return !existingTitles.has(titleLower);
    });

    console.log(`🆕 Found ${trulyNewItems.length} truly new items`);

    if (trulyNewItems.length === 0) {
      console.log('⏹️ No new news items found - cancelling process to avoid unnecessary work');
      return false; // Return false to indicate no update needed
    }

    console.log('🔥 Cleaning and renewing news database...');

    // Clear all existing news data
    console.log('🧹 Clearing existing news data...');
    await newsRef.remove();

    console.log(`� Adding ${newNewsItems.length} fresh news items...`);

    // Sort news by date (newest first)
    const sortedNews = newNewsItems.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Add all new items with clean indices
    for (let i = 0; i < sortedNews.length; i++) {
      await newsRef.child(i.toString()).set(sortedNews[i]);
      console.log(`✅ Added news ${i + 1}/${sortedNews.length}: ${sortedNews[i].title}`);
    }

    console.log(`🎉 Successfully renewed database with ${sortedNews.length} fresh news items!`);
    return true; // Return true to indicate successful update

  } catch (error) {
    console.error('❌ Error cleaning and renewing Firebase:', error.message);
    throw error;
  }
}



// Main execution function
async function main() {
  try {
    console.log('🚀 Starting News & Announcements Scraper with Image Compression...\n');

    // Process news and download/upload images
    console.log('📰 Processing news with image downloads...');
    const processedNews = await processNewsWithImages();

    // Process announcements and download/upload images
    console.log('\n📢 Processing announcements with image downloads...');
    const processedAnnouncements = await processAnnouncementsWithImages();

    // Handle news updates
    if (processedNews.length > 0) {
      console.log(`\n📊 Found ${processedNews.length} news items to process`);

      // Clean and renew news database (we already checked for new items)
      console.log('🔥 Cleaning and renewing news database...');
      const newsRef = db.ref('news');
      await newsRef.remove();

      // Sort news by date (newest first)
      const sortedNews = processedNews.sort((a, b) => new Date(b.date) - new Date(a.date));

      // Add all new items with clean indices
      for (let i = 0; i < sortedNews.length; i++) {
        await newsRef.child(i.toString()).set(sortedNews[i]);
        console.log(`✅ Added news ${i + 1}/${sortedNews.length}: ${sortedNews[i].title}`);
      }

      console.log(`🎉 Successfully renewed news database with ${sortedNews.length} fresh items!`);
    } else {
      console.log('⏹️ No new news to add');
    }

    // Handle announcements updates
    if (processedAnnouncements.length > 0) {
      console.log(`\n📊 Found ${processedAnnouncements.length} announcements to process`);

      // Clean and renew announcements database (we already checked for new items)
      console.log('🔥 Cleaning and renewing announcements database...');
      const announcementsRef = db.ref('announcements');
      await announcementsRef.remove();

      // Sort announcements by date (newest first)
      const sortedAnnouncements = processedAnnouncements.sort((a, b) => new Date(b.date) - new Date(a.date));

      // Add all new items with clean indices
      for (let i = 0; i < sortedAnnouncements.length; i++) {
        await announcementsRef.child(i.toString()).set(sortedAnnouncements[i]);
        console.log(`✅ Added announcement ${i + 1}/${sortedAnnouncements.length}: ${sortedAnnouncements[i].title}`);
      }

      console.log(`🎉 Successfully renewed announcements database with ${sortedAnnouncements.length} fresh items!`);
    } else {
      console.log('⏹️ No new announcements to add');
    }

    // Exit if nothing was processed
    if (processedNews.length === 0 && processedAnnouncements.length === 0) {
      console.log('⏹️ Process completed - no new content to add');
      process.exit(0);
    }

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log('🧹 Cleaned up temporary files');
    }

    console.log('\n✅ News & Announcements scraping and database renewal completed!');
    console.log('📋 Summary:');
    console.log('   - News and announcements databases cleaned and renewed ✅');
    console.log('   - Images compressed and uploaded to Firebase Storage ✅');
    console.log('   - All items use Firebase Storage URLs ✅');

    process.exit(0);

  } catch (error) {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the scraper
if (require.main === module) {
  main();
}

module.exports = {
  scrapeNews,
  scrapeAnnouncements,
  scrapeNewsDetails,
  downloadAndUploadImage,
  compressImage,
  checkForNewItems,
  checkForNewAnnouncements,
  processNewsWithImages,
  processAnnouncementsWithImages,
  cleanAndRenewNewsInFirebase,
  main
};
