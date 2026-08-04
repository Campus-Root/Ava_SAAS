import axios from 'axios';
import { parseStringPromise } from "xml2js";
import https from "https";
import "dotenv/config";
// import pLimit from "p-limit";
import { SitemapLoader } from "@langchain/community/document_loaders/web/sitemap";
import { Collection } from '../models/Collection.js';
// import { urlProcessingQueue } from "./bull.js";
export const sitemapGenerator = async (mainUrl) => {
  try {
    // Attempt to fetch robots.txt
    let sitemapUrls = [];
    try {
      const response = await axios.get(`${mainUrl}/robots.txt`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36'
        }
      });
      const match = response.data.match(/Sitemap:\s*(.+)/gi);
      if (match) sitemapUrls = match.map(line => line.replace(/Sitemap:\s*/, '').trim());
    } catch (err) { console.warn(`No robots.txt found for ${mainUrl}, trying default sitemap paths.`); }
    if (sitemapUrls.length === 0) {
      const commonPaths = [
        '/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/sitemap.php',
        '/sitemap.txt', '/sitemap.xml.gz', '/sitemap/', '/sitemap/sitemap.xml',
        '/sitemapindex.xml', '/sitemap/index.xml', '/sitemap1.xml'
      ];
      await Promise.all(commonPaths.map(async (path) => {
        try {
          const sitemapResponse = await axios.get(`${mainUrl}${path}`);
          if (sitemapResponse.status === 200) sitemapUrls.push(`${mainUrl}${path}`);
        } catch (error) {
          console.error(`error at ${path}`);
        }
      }))
    }
    if (sitemapUrls.length === 0) {
      console.error(`No sitemap found for ${mainUrl}`);
      return [];
    }
    return sitemapUrls;
  } catch (error) {
    console.error(`Error processing ${mainUrl}:`, error.message);
    if (axios.isAxiosError(error)) {
      console.error('Error status:', error.response?.status);
      console.error('Error at sitemapGenerator:', error.response?.data || error.message);
    } else {
      console.error('Unexpected error:', error);
    }
    return [];
  }
};
const userAgents = [
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"
];
const agent = new https.Agent({ rejectUnauthorized: false });
export const fetchUrlsFromSitemap = async (sitemapUrls) => {
  const seenUrls = new Set();
  const fetchSitemap = async (url, attempt = 0) => {
    if (seenUrls.has(url)) return [];
    seenUrls.add(url);

    try {
      const response = await axios.get(url, {
        // headers: { "User-Agent": userAgents[attempt % userAgents.length] },
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "en-US,en;q=0.9",
          "Connection": "keep-alive",
        },
        httpsAgent: agent,
        timeout: 15000,
      });

      const xmlData = await parseStringPromise(response.data);
      const urls = [];

      if (xmlData.urlset && xmlData.urlset.url) {
        xmlData.urlset.url.forEach((entry) => {
          if (entry.loc) {
            urls.push({
              url: entry.loc[0],
              lastmod: entry.lastmod ? entry.lastmod[0] : null,
            });
          }
        });
      }

      if (xmlData.sitemapindex && xmlData.sitemapindex.sitemap) {
        const nestedSitemaps = xmlData.sitemapindex.sitemap.map((entry) => entry.loc[0]);
        return urls.concat(await Promise.all(nestedSitemaps.map(fetchSitemap)).then(res => res.flat()));
      }

      return urls;
    } catch (error) {
      console.error(`Error fetching ${url}: ${error.message}`);
      if (attempt < userAgents.length - 1) {
        console.log(`Retrying ${url} with a different User-Agent...`);
        return fetchSitemap(url, attempt + 1);
      }
      return [];
    }
  };

  const allFetchedUrls = sitemapUrls.length > 0 ? await Promise.all(sitemapUrls.map(fetchSitemap)) : []
  return allFetchedUrls.flat();
};

export const FetchUsingDroxy = async (url) => {
  try {
    let response = await fetch("https://api.droxy.ai/auth/login", {
      "headers": {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        "content-type": "application/json",
        "pragma": "no-cache",
        "priority": "u=1, i",
        "sec-ch-ua": "\"Not A(Brand\";v=\"8\", \"Chromium\";v=\"132\", \"Google Chrome\";v=\"132\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"macOS\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "Referer": "https://app.droxy.ai/",
        "Referrer-Policy": "strict-origin-when-cross-origin"
      },
      "body": "{\"email\":\"gehawi7086@nike4s.com\",\"password\":\"Gehawi7086@nike4s\"}",
      "method": "POST"
    });
    const { accessToken } = await response.json();
    console.log("fetched access token");
    let encodedUrl = encodeURIComponent(url);
    response = await fetch(`https://api.droxy.ai/website/sub-links?url=${encodedUrl}`, {
      "headers": {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        "authorization": `Bearer ${accessToken}`,
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "priority": "u=1, i",
        "sec-ch-ua": "\"Not A(Brand\";v=\"8\", \"Chromium\";v=\"132\", \"Google Chrome\";v=\"132\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"macOS\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "Referer": "https://app.droxy.ai/",
        "Referrer-Policy": "strict-origin-when-cross-origin"
      },
      "body": null,
      "method": "GET"
    });
    const data = await response.json();
    return {
      urls: data.map(ele => {
        return {
          "url": ele
        }
      }),
      success: true
    }
  } catch (error) {
    console.error("error with api.droxy error:", error);
    return { success: false, error: error.message }
  }
}
export const processURLS = async (collectionId, urls, receiver, _id) => {
  try {
    // console.log(JSON.stringify({ UrlData: urls.map(({ url }) => ({ url, collectionId, receiver, _id, options: {} })) }, null, 2));
    await axios.post(`${process.env.BULL_URL}api/queues/processingUrls/jobs`, { UrlData: urls.map(({ url }) => ({ url, collectionId, receiver, _id, options: {} })) });
  } catch (error) {
    console.error('Failed to add URL processing job:', error);
    throw error;
  }
};
export const fetchUrlsUsingLangChain = async (sitemapUrl, visited = new Set()) => {
  try {
    if (visited.has(sitemapUrl)) return [];
    visited.add(sitemapUrl);
    // Initialize the SitemapLoader with the given URL
    const loader = new SitemapLoader(sitemapUrl);

    // Load all URLs from the sitemap
    const sitemap = await loader.parseSitemap();

    let allUrls = [];
    for (const entry of sitemap) {
      if (entry.loc.endsWith(".xml")) {
        // Recursively fetch sub-sitemaps
        const subUrls = await fetchSitemapUrls(entry.loc, visited);
        allUrls = allUrls.concat(subUrls);
      } else {
        allUrls.push(entry.loc);
      }
    }
    return allUrls;
  } catch (error) {
    console.error("Error fetching sitemap URLs:", error);
    return [];
  }
}