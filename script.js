document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const setupContainer = document.getElementById('setup-container');
    const roundButtons = document.querySelectorAll('.round-btn');
    const groupingButtons = document.querySelectorAll('.grouping-btn');
    const roundsSelection = document.getElementById('rounds-selection');
    const startGameBtn = document.getElementById('start-game-btn');
    const mapContainer = document.getElementById('map');
    const uiContainer = document.getElementById('ui-container');
    const questionEl = document.getElementById('question');
    const quitGameBtn = document.getElementById('quit-game-btn');
    const resultEl = document.getElementById('result');
    const nextRoundBtn = document.getElementById('next-round-btn');
    const gameOverContainer = document.getElementById('game-over-container');
    const playAgainBtn = document.getElementById('play-again-btn');
    const currentRoundEl = document.getElementById('current-round');
    const totalRoundsEl = document.getElementById('total-rounds');
    const totalScoreEl = document.getElementById('total-score');
    const finalScoreEl = document.getElementById('final-score');
    const maxPossibleScoreEl = document.getElementById('max-possible-score');

    // --- Map Initialization ---
    const map = L.map('map', {
        center: [20, 0],
        zoom: 2,
        minZoom: 4, // DO NOT CHANGE THESE
        maxZoom: 8, // DO NOT CHANGE THESE
        // The maxBounds option has been removed to allow horizontal wrapping.
    });

    // Switched to a satellite tile layer with no labels
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        referrerPolicy: 'origin',
        worldCopyJump: true // This enables the seamless wrapping effect.
    }).addTo(map);

    // --- Game State ---
    let currentCapital = null;
    let guessMarker = null;
    let answerMarker = null;
    let answerLine = null;
    let mapClickHandler = null;
    let totalRounds = 0;
    let currentRound = 0;
    let totalScore = 0;
    let availableCapitals = [];
    let isEndlessMode = false;
    let selectedGrouping = null;

    let currentCapitalPool = []; // The pool of capitals for the current game
    let gameWeightedPlayedCapitals = []; // Weighted list of previously played capitals for the current game
    const RECENT_CAPITALS_LIMIT = 5; // How many recent capitals to avoid picking
    let recentlyChosenCapitals = []; // Stores the last N chosen capitals
    let cityScores = {}; // Stores best scores for each city: { "city-country": bestScore }

    // --- Functions ---

    /**
     * Fetches and transforms capital data from the REST Countries API for a specific region.
     * @param {string} region - The region to fetch (e.g., 'europe') or 'all' for the whole world.
     * @returns {Promise<Array>} A promise that resolves to an array of capital objects.
     */
    async function fetchCountryCapitals(region) {
        const fields = 'name,capital,capitalInfo,cca2';
        const baseUrl = 'https://restcountries.com/v3.1/';
        const url = region === 'all' 
            ? `${baseUrl}all?fields=${fields}` 
            : `${baseUrl}region/${region}?fields=${fields}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            console.log(`Fetched raw capitals for region '${region}':`, data);
            // Transform the data into the format our game expects
            const transformedData = data
                .filter(country => country.capital && country.capital.length > 0 && country.capitalInfo && country.capitalInfo.latlng)
                .map(country => ({
                    city: country.capital[0],
                    country: country.name.common,
                    lat: country.capitalInfo.latlng[0], // Latitude
                    lon: country.capitalInfo.latlng[1]  // Longitude
                }));
            console.log(`Transformed capitals for region '${region}':`, transformedData);
            return transformedData;
        } catch (error) {
            console.error(`Could not fetch capitals for region '${region}':`, error);
            return []; // Return empty array on error
        }
    }

    /**
     * Fetches and transforms US state capital data from a public API.
     * @returns {Promise<Array>} A promise that resolves to an array of US state capital objects.
     */
    async function fetchUsStateCapitals() {
        try {
            // Using the CSV source provided by the user.
            const response = await fetch('https://raw.githubusercontent.com/jasperdebie/VisInfo/refs/heads/master/us-state-capitals.csv');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const csvText = await response.text();
            console.log('Fetched raw US state capitals CSV:', csvText);

            // Parse the CSV data. The format is: name,lat,lon,capital
            const lines = csvText.trim().split('\n');
            const transformedData = lines
                .slice(1) // Skip the header row
                .map(line => {
                    const [name, capital, lat, lon] = line.split(','); 
                    return {
                        city: capital.replace(/<br>/g, ''), // Strip out any <br> tags
                        country: name, // Using the state name for the 'country' field
                        lat: parseFloat(lat),
                        lon: parseFloat(lon)
                    };
                });
            console.log('Transformed US state capitals:', transformedData);
            return transformedData;
        } catch (error) {
            console.error('Could not fetch US state capitals:', error);
            return [];
        }
    }

    function getCityId(capital) {
        return `${capital.city}-${capital.country}`;
    }

function generateObjectDistribution(itemsWithStreaks) {
    const numItems = itemsWithStreaks.length;
    if (numItems === 0) return [];

    // 1. Count how many items exist for each unique streak value.
    const streakCounts = new Map();
    for (const item of itemsWithStreaks) {
        streakCounts.set(item.value, (streakCounts.get(item.value) || 0) + 1);
    }

    // 2. Get all unique streak values and sort them from worst to best (e.g., -2, 0, 1, 5).
    const sortedUniqueStreaks = Array.from(streakCounts.keys()).sort((a, b) => a - b);
    const numUniqueStreaks = sortedUniqueStreaks.length;

    // Edge case: If all items have the exact same streak, give them all an equal, high weight.
    if (numUniqueStreaks === 1) {
        const weightedArray = [];
        for (const item of itemsWithStreaks) {
            for (let j = 0; j < 20; j++) weightedArray.push(item.item); 
        }
        return weightedArray;
    }

    // 3. Calculate the total "rank weight" sum. A lower streak gets a higher rank.
    let totalRankWeight = 0;
    for (let i = 0; i < numUniqueStreaks; i++) {
        const streakValue = sortedUniqueStreaks[i];
        const numItemsWithThisStreak = streakCounts.get(streakValue);
        const rank = numUniqueStreaks - 1 - i; // Highest rank for the lowest streak
        totalRankWeight += numItemsWithThisStreak * rank;
    }

    // 4. Calculate a scaling factor to make the final array size proportional to the number of items.
    const scalingFactor = (19 * numItems) / totalRankWeight;

    // 5. Pre-calculate the number of copies for each unique streak value.
    const copiesPerStreak = new Map();
    for (let i = 0; i < numUniqueStreaks; i++) {
        const streakValue = sortedUniqueStreaks[i];
        const rank = numUniqueStreaks - 1 - i;
        const numCopies = Math.round(1 + scalingFactor * rank);
        copiesPerStreak.set(streakValue, numCopies);
    }

    const weightedArray = [];
    const debugArray = [];

    // 6. Build the final weighted array.
    for (const item of itemsWithStreaks) {
        const copies = copiesPerStreak.get(item.value);
        
        for (let j = 0; j < copies; j++) {
            // Note: This pushes the object reference. 
            // If you need unique clones of the object, you would use something like structuredClone(entry.item) here.
            weightedArray.push(item.item);
        }
        const cityname = item.item.city;
        const countryname = item.item.country;
        const streak = item.value;
       
        debugArray.push({streak, copies, cityname, countryname});
    }
    console.log("Debug array:", debugArray);
    return weightedArray;
}

    /**
     * Starts the game with a selected number of rounds.
     */
    async function startGame(rounds, grouping) {
        startGameBtn.disabled = true;
        startGameBtn.textContent = 'Loading...';

        // 1. Fetch data on-demand based on the selected grouping
        let fetchedCapitals = [];
        switch (grouping) {
            case 'usstates':
                fetchedCapitals = await fetchUsStateCapitals();
                break;
            case 'europe':
                fetchedCapitals = await fetchCountryCapitals('europe');
                break;
            case 'all':
                fetchedCapitals = await fetchCountryCapitals('all');
                break;
            default:
                console.error("Invalid grouping selected:", grouping);
                startGameBtn.disabled = false;
                startGameBtn.textContent = 'Start Game';
                return;
        }

        if (fetchedCapitals.length === 0) {
            alert("Could not load capital data for this grouping. Please try again.");
            startGameBtn.disabled = false;
            startGameBtn.textContent = 'Start Game';
            return;
        }

        // 2. Set up game state
        isEndlessMode = (rounds === 'endless'); // Set endless mode flag
        totalRounds = isEndlessMode ? Infinity : rounds; // Set totalRounds to Infinity for endless mode
        currentRound = 0;
        totalScore = 0;
        selectedGrouping = grouping;
        quitGameBtn.style.display = 'none'; // Hide quit button initially
        currentCapitalPool = [...fetchedCapitals];
        availableCapitals = [...fetchedCapitals];

        if (availableCapitals.length === 0) {
            alert("No capital data loaded for this difficulty. Please try again later.");
            // Optionally, reset UI to setup container
            setupContainer.style.display = 'block';
            mapContainer.style.display = 'none';
            uiContainer.style.display = 'none';
            return;
        }

        // 3. Transition to the game view
        setupContainer.style.display = 'none';
        gameOverContainer.style.display = 'none';
        mapContainer.style.display = 'block';
        uiContainer.style.display = 'block';

        // Tell Leaflet to update its size now that the container is visible, and recenter
        map.invalidateSize(); // Ensure map tiles render correctly
        map.setView([20, 0], 2); // Reset map view for new game start

        startGameBtn.disabled = false;
        startGameBtn.textContent = 'Start Game';

        startNewRound();
    }

    /**
     * Loads city scores from localStorage.
     */
    function loadCityScores() {
        try {
            const storedScores = localStorage.getItem('capitalQuizScores');
            if (storedScores) {
                cityScores = JSON.parse(storedScores);
                console.log('Loaded city scores:', cityScores);
            }
        } catch (e) {
            console.error('Error loading city scores from localStorage:', e);
            cityScores = {}; // Reset if corrupted
        }
    }

    /**
     * Saves the best score for a city to localStorage.
     * @param {object} capital - The capital object.
     * @param {number} score - The score achieved in the round.
     */
    function saveCityScore(capital, score) {
        const CORRECT_SCORE_THRESHOLD = 98;
        const cityId = getCityId(capital);
        const streak = cityScores[cityId]?.streak || 0;
        // Get existing data or create a new entry
        const cityData = { score: 0, streak: streak};

        // Update score.
        cityData.score = score;

        // Update streak based on performance
        if (score >= CORRECT_SCORE_THRESHOLD) {
            cityData.streak = Math.max(1, cityData.streak + 1); // Increment streak, ensuring it's at least 1 for a correct answer.
        } else {
            cityData.streak = -2; // Set a negative streak for a wrong answer to heavily prioritize it.
        }
        cityScores[cityId] = cityData;
        localStorage.setItem('capitalQuizScores', JSON.stringify(cityScores));
        console.log(`Updated data for ${cityId}:`, cityData);
    }

    /**
     * Calculates distance between two lat/lon points in km using Haversine formula.
     */
    function getDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radius of the Earth in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    
    /**
     * Calculates a score from 0 to 100 based on the distance.
     * The score decreases as the distance increases.
     */
    function calculateScore(distance) {
        const maxDistance = 4000; // Max distance in km for scoring
        if (distance > maxDistance) {
            return 0;
        }
        // A non-linear scoring works well. We use a power to make it harder.
        const score = 100 * Math.pow(1 - (distance / maxDistance), 2);
        return Math.round(score);
    }

    /**
     * Starts a new round of the game.
     */
    function startNewRound() {
        // 0. Increment round counter and update UI
        currentRound++;
        totalRoundsEl.textContent = totalRounds;
        currentRoundEl.textContent = currentRound;
        if (isEndlessMode) totalRoundsEl.textContent = '∞'; // Display infinity for endless mode
        totalScoreEl.textContent = totalScore;

        // 1. Reset UI and map layers
        resultEl.innerHTML = '';
        nextRoundBtn.style.display = 'none';
        quitGameBtn.style.display = 'none'; // Ensure quit button is hidden at the start of a round
        if (guessMarker) map.removeLayer(guessMarker);
        if (answerMarker) map.removeLayer(answerMarker);
        if (answerLine) map.removeLayer(answerLine); 
        // map.setView([20, 0], 2); // Removed per user request to not reset view each round

        gameWeightedPlayedCapitals = [];

        const potentialPicks = availableCapitals.filter(c => !recentlyChosenCapitals.some(rc => getCityId(rc) === getCityId(c)));
        
        const picksWithWeights = potentialPicks.map(item => {
            const cityId = getCityId(item);
            const value = cityScores[cityId]?.streak || 0;                      
            return { item, value };
        });

        gameWeightedPlayedCapitals = generateObjectDistribution(picksWithWeights);

        console.log('Weighted played capitals:', gameWeightedPlayedCapitals);
      
        if (gameWeightedPlayedCapitals.length > 0) {
            const randomIndex = Math.floor(Math.random() * gameWeightedPlayedCapitals.length);
            currentCapital = gameWeightedPlayedCapitals[randomIndex]; // Just pick, don't splice yet
            console.log("Got new capital from weighted list:", currentCapital.city, ' ', currentCapital.country);
        } else {
            // Fallback: if both lists are exhausted, pick randomly from the original pool
            currentCapital = currentCapitalPool[Math.floor(Math.random() * currentCapitalPool.length)];
        }

        // Manage the recently chosen list
        // Add the new capital to the front
        recentlyChosenCapitals.unshift(currentCapital);
        // If the list is over the limit, remove the oldest item from the end
        if (recentlyChosenCapitals.length > RECENT_CAPITALS_LIMIT) {
            recentlyChosenCapitals.pop();
        }
        console.log('Recently chosen capitals:', recentlyChosenCapitals);

        questionEl.textContent = `Where is ${currentCapital.city}, ${currentCapital.country}?`;

        // 3. Enable map clicking
        mapClickHandler = map.on('click', handleMapClick);
    }

    /**
     * Ends the game and displays the final score.
     */
    function endGame(quitEarly = false) {
        const maxPossibleScore = isEndlessMode ? (currentRound * 100) : (totalRounds * 100);
        mapContainer.style.display = 'none';
        uiContainer.style.display = 'none';
        gameOverContainer.style.display = 'block';
        finalScoreEl.textContent = totalScore;
        maxPossibleScoreEl.textContent = maxPossibleScore;
    }

    /**
     * Handles the user's click on the map.
     */
    function handleMapClick(e) {
        // Disable further clicks
        if (mapClickHandler) {
            map.off('click', handleMapClick);
            mapClickHandler = null;
        }

        // Normalize the clicked coordinates to the [-180, 180] longitude range
        const wrappedLatLng = e.latlng.wrap();
        const guessLat = wrappedLatLng.lat;
        const guessLon = wrappedLatLng.lng;

        const answerLat = currentCapital.lat;
        const answerLon = currentCapital.lon;

        // Calculate distance and score
        const distance = getDistance(guessLat, guessLon, answerLat, answerLon);
        const score = calculateScore(distance);
        totalScore += score;
        saveCityScore(currentCapital, score); // Save the score for the current city
        const streak = cityScores[getCityId(currentCapital)]?.streak || 0;
        // Display results
        resultEl.innerHTML = `You were <b>${distance.toFixed(0)} km</b> away. Your score is <b>${score}/100</b>. Streak: <b>${streak}</b>`;
        totalScoreEl.textContent = totalScore; // Update total score display
        nextRoundBtn.style.display = 'block';
        if (isEndlessMode) {
            quitGameBtn.style.display = 'block'; // Show quit button next to next round button
        }

        // Change button text for the last round or in endless mode
        if (isEndlessMode) {
            nextRoundBtn.textContent = 'Next Round';
        } else if (currentRound >= totalRounds) {
            nextRoundBtn.textContent = 'Finish Game';
        } else {
            nextRoundBtn.textContent = 'Next Round';
        }

        // Show markers and line on the map
        guessMarker = L.marker([guessLat, guessLon]).addTo(map).bindPopup("Your Guess").openPopup();
        answerMarker = L.marker([answerLat, answerLon]).addTo(map).bindPopup(`The answer: ${currentCapital.city}`).openPopup();
        answerLine = L.polyline([[guessLat, guessLon], [answerLat, answerLon]], { color: 'red' }).addTo(map);

        // Fit map to show both points
        map.fitBounds(answerLine.getBounds().pad(0.1));
    }

    // --- Event Listeners ---
    groupingButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            selectedGrouping = e.target.getAttribute('data-grouping');
            groupingButtons.forEach(btn => btn.classList.remove('selected'));
            e.target.classList.add('selected');
            roundsSelection.style.display = 'block';
        });
    });

    roundButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            selectedRounds = e.target.getAttribute('data-rounds'); // Get as string
            if (selectedRounds !== 'endless') selectedRounds = parseInt(selectedRounds, 10); // Parse to int if not endless
            roundButtons.forEach(btn => btn.classList.remove('selected'));
            e.target.classList.add('selected');
            startGameBtn.disabled = false; // Enable the start button
        });
    });

    startGameBtn.addEventListener('click', async () => {
        if (selectedGrouping && selectedRounds) {
            await startGame(selectedRounds, selectedGrouping);
        }
    });

    nextRoundBtn.addEventListener('click', () => {
        if (isEndlessMode || currentRound < totalRounds) {
            startNewRound();
        } else {
            endGame();
        }
    });

    quitGameBtn.addEventListener('click', () => {
        if (isEndlessMode) {
            endGame(true); // Call endGame with a flag indicating early quit
        }
    });

    playAgainBtn.addEventListener('click', () => {
        // Show the initial setup screen to start a new game
        gameOverContainer.style.display = 'none';
        setupContainer.style.display = 'block';
        // Reset selections for the next game
        roundsSelection.style.display = 'none';
        startGameBtn.disabled = true;
        groupingButtons.forEach(btn => btn.classList.remove('selected'));
        roundButtons.forEach(btn => btn.classList.remove('selected'));
        quitGameBtn.style.display = 'none'; // Ensure quit button is hidden
        startGameBtn.disabled = true; // Disable start button until new selection
        isEndlessMode = false; // Reset endless mode state
        selectedGrouping = null;
        selectedRounds = null;
    });

    // --- Initial Setup ---
    loadCityScores(); // Load any existing user scores from localStorage

});