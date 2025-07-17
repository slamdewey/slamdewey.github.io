const fs = require('fs');
const { exit } = require('process');
var images = require('./src/app/images.json');

// does images.json exist?
if (images === undefined) {
  console.error('images.json not found');
  exit(1);
}

var newImagesJson = {};
newImagesJson.img_path = images.img_path;
newImagesJson.placeholder_path = images.placeholder_path;
newImagesJson.directories = images.directories;
newImagesJson.img = {};

var newlyFoundImages = [];

images.directories.forEach((folder) => {
  var srcFilenames = fs.readdirSync('./src/assets/img/' + folder + '/');
  var placeholderFilenames = fs.readdirSync('./src/assets/placeholder/' + folder + '/');
  // create empty image sets
  var imageSet = [];

  // loop through all images in folder
  srcFilenames.forEach((filename) => {
    const relativeFilePath = folder + '/' + filename;
    var imgEntry = images.img[folder]?.find((existingImgEntry) => existingImgEntry.fileName === filename);

    // check if folder was already known:
    if (images.img[folder] !== undefined) {
      // check if file was already known:
      images.img[folder].forEach((existingImgEntry) => {
        // try to find file in old json list
        if (existingImgEntry.filename === filename) {
          // if it exists, copy over data
          imgEntry = existingImgEntry;
          return;
        }
      });
    }

    // if the entry did not exist in previous json file
    if (imgEntry === undefined) {
      let lastModified = fs.statSync('./src/assets/img/' + relativeFilePath, undefined).mtime;

      // create new entry data
      imgEntry = {
        img_src: images.img_path + relativeFilePath,
        placeholder_src: undefined,
        title: '',
        caption: '',
        lastModified,
      };
      newlyFoundImages.push(relativeFilePath);
    }

    var matchingPlaceholderFilename = placeholderFilenames.find((val) => {
      return val.startsWith(filename.substring(0, filename.indexOf('.')));
    });
    imgEntry.placeholder_src = images.placeholder_path + folder + '/' + matchingPlaceholderFilename;
    console.log(imgEntry.placeholder_src);
    // add file to imageSet
    imageSet.push(imgEntry);
  });

  // sort files by date (most recent first)
  imageSet = imageSet.sort((a, b) => (new Date(a.lastModified) < new Date(b.lastModified) ? 1 : -1));

  newImagesJson.img[folder] = imageSet;
});

fs.writeFileSync('./src/app/images.json', JSON.stringify(newImagesJson), (err) => {
  if (err) console.error(err);
});
if (newlyFoundImages.length > 0) {
  console.log('Added the following new images:');
  newlyFoundImages.forEach((fileName) => {
    console.log('\t' + fileName);
  });
}

console.log('Successfully updated images.json');
var totalImageCount = 0;

for (const [folder, images] of Object.entries(newImagesJson.img)) {
  var imageCountInFolder = images.length;
  console.log('\t' + folder + ': ' + imageCountInFolder + ' images');
  totalImageCount += imageCountInFolder;
}

console.log('images.json now tracks a total of ' + totalImageCount + ' images.');
