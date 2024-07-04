let retries = 0;
const maxRetries = 3; // Maximum retries before giving up

while (nextPage) {
  page += 1;
  console.log(`Fetching page number ${page}`);

  let currentPage = [];
  try {
    currentPage = await armanFollowingsFeed.items();
    nextPage = armanFollowingsFeed.isMoreAvailable();

    if (currentPage.length === 0) {
      console.log('No more items fetched, stopping.');
      nextPage = false; // Stop if no items are fetched
    } else {
      // Reset retry counter on successful fetch
      retries = 0;
    }

  } catch (err) {
    console.error(`Error fetching followings for page ${page}:`, err);
    retries += 1;

    if (retries >= maxRetries) {
      console.log(`Max retries reached. Stopping pagination after ${page} pages.`);
      nextPage = false; // Stop pagination after maximum retries
    } else {
      console.log(`Retrying... (attempt ${retries} of ${maxRetries})`);
      await sleep(5000); // Sleep for 5 seconds before retrying
      nextPage = true; // Continue trying to fetch the same page
    }
  }

  allFollowings = allFollowings.concat(currentPage);

  // Process the users if any were fetched
  for (const user of currentPage) {
    try {
      const storyFeed = ig.feed.userStory(user.pk);
      const userStories = await storyFeed.items();

      if (userStories && userStories.length > 0) {
        console.log(`Stories of ${user.username}`);
        userStories.forEach(story => {
          console.log(`- Story ID: ${story.id}, Media Type: ${story.media_type}`);
          if (story.media_type === 1 && story.image_versions2) {
            console.log(`  Image URL: ${story.image_versions2.candidates[0].url}`);
            result += 8; // Arbitrary metric for images
          } else if (story.media_type === 2 && story.video_versions) {
            console.log(`  Video URL: ${story.video_versions[0].url}`);
            result += story.video_duration || 0; // Metric for video duration
          }
        });
      }

      userCount += 1;

      if (userCount % 20 === 0) {
        try {
          await redisSetAsync(`story_result_${userCount}`, result);
          console.log(`Stored result in Redis for ${userCount} users: ${result}`);
        } catch (redisError) {
          console.error(`Error storing result in Redis for user ${user.username}:`, redisError);
        }
      }

      const randomSleep = randomInt(1000, 10000);
      console.log(`Sleeping for ${randomSleep} ms...`);
      await sleep(randomSleep);

    } catch (storyError) {
      console.error(`Error fetching stories for user ${user.username}:`, storyError);
    }
  }
}
