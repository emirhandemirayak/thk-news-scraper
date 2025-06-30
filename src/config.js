// Configuration for the news scraper
module.exports = {
  // Website configuration
  BASE_URL: 'https://www.thk.edu.tr',
  NEWS_PAGE_URL: 'https://www.thk.edu.tr/haberler',
  
  // Firebase configuration
  FIREBASE_DATABASE_URL: 'https://edugoryy-default-rtdb.europe-west1.firebasedatabase.app/',
  FIREBASE_STORAGE_BUCKET: 'edugoryy.appspot.com',
  
  // Scraping limits
  MAX_NEWS_ITEMS: 15,
  MAX_RETRIES: 3,
  DELAY_BETWEEN_REQUESTS: 1000, // milliseconds
  
  // Image processing
  IMAGE_QUALITY: 80,
  MAX_IMAGE_SIZE: 1024, // pixels
  SUPPORTED_IMAGE_FORMATS: ['.jpg', '.jpeg', '.png', '.webp'],
  
  // Safety settings
  CREATE_BACKUP: true,
  PRESERVE_EXISTING_DATA: true,
  CHECK_DUPLICATES: true,
  
  // Timeouts
  REQUEST_TIMEOUT: 30000, // 30 seconds
  IMAGE_DOWNLOAD_TIMEOUT: 15000, // 15 seconds
  
  // Selectors for THK website (can be customized)
  NEWS_SELECTORS: [
    '.news-item',
    '.haber-item', 
    '.news-list-item',
    '.article-item',
    'article',
    '.post-item',
    '.content-item'
  ],
  
  TITLE_SELECTORS: [
    'h1', 'h2', 'h3', 'h4', 
    '.title', '.news-title', '.post-title', 
    'a[title]'
  ],
  
  IMAGE_SELECTORS: [
    'img[src]',
    'img[data-src]',
    '.image img',
    '.news-image img'
  ],
  
  DATE_SELECTORS: [
    '.date', '.news-date', '.post-date', 
    'time', '.tarih', '.publish-date'
  ],
  
  // Logging
  VERBOSE_LOGGING: true,
  LOG_ERRORS: true,
  LOG_SUCCESS: true
};
