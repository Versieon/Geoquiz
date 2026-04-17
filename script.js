document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const setupContainer = document.getElementById('setup-container');
    const roundButtons = document.querySelectorAll('.round-btn');
    const difficultyButtons = document.querySelectorAll('.difficulty-btn');
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
    let isEndlessMode = false; // Flag for endless mode
    let selectedDifficulty = null;

    // --- Data Storage for different difficulties ---
    let worldCapitalsData = [];
    let usStateCapitalsData = [];
    let europeanCapitalsData = [];
    let currentCapitalPool = []; // The pool of capitals for the current game
    let gameNeverPlayedCapitals = []; // Capitals for the current game that have never been played
    let gameWeightedPlayedCapitals = []; // Weighted list of previously played capitals for the current game
    const RECENT_CAPITALS_LIMIT = 10; // How many recent capitals to avoid picking
    let recentlyChosenCapitals = []; // Stores the last N chosen capitals
    let cityScores = {}; // Stores best scores for each city: { "city-country": bestScore }

    // --- Functions ---

    /**
     * Fetches and transforms world capital data from the REST Countries API.
     * @returns {Promise<Array>} A promise that resolves to an array of world capital objects.
     */
    async function fetchWorldCapitals() {
        try {
            const response = await fetch('https://restcountries.com/v3.1/all?fields=name,capital,capitalInfo,cca2');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            console.log('Fetched raw world capitals:', data);
            // Transform the data into the format our game expects
            const transformedData = data
                .filter(country => country.capital && country.capital.length > 0 && country.capitalInfo && country.capitalInfo.latlng)
                .map(country => ({
                    city: country.capital[0],
                    country: country.name.common,
                    lat: country.capitalInfo.latlng[0],
                    lon: country.capitalInfo.latlng[1]
                }));
            console.log('Transformed world capitals:', transformedData);
            return transformedData;
        } catch (error) {
            console.error('Could not fetch world capitals:', error);
            return []; // Return empty array on error
        }
    }

    /**
     * Fetches and transforms European capital data from the REST Countries API.
     * @returns {Promise<Array>} A promise that resolves to an array of European capital objects.
     */
    async function fetchEuropeanCapitals() {
        try {
            const response = await fetch('https://restcountries.com/v3.1/region/europe?fields=name,capital,capitalInfo,cca2');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            console.log('Fetched raw European capitals:', data);
            // Transform the data into the format our game expects
            const transformedData = data
                .filter(country => country.capital && country.capital.length > 0 && country.capitalInfo && country.capitalInfo.latlng)
                .map(country => ({
                    city: country.capital[0],
                    country: country.name.common,
                    lat: country.capitalInfo.latlng[0],
                    lon: country.capitalInfo.latlng[1]
                }));
            console.log('Transformed European capitals:', transformedData);
            return transformedData;
        } catch (error) {
            console.error('Could not fetch European capitals:', error);
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
                    const [name, capital, lat, lon] = line.split(','); // THIS IS THE CORRECT FORMAT, DO NOT CHANGE
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

    /**
     * Initializes the game by fetching all necessary capital data.
     */
    async function initializeGameData() {
        // Disable buttons while data is loading to prevent a race condition
        difficultyButtons.forEach(btn => btn.disabled = true);

        [worldCapitalsData, usStateCapitalsData, europeanCapitalsData] = await Promise.all([
            fetchWorldCapitals(),
            fetchUsStateCapitals(),
            fetchEuropeanCapitals()
        ]);
        console.log('World Capitals Loaded:', worldCapitalsData.length);
        console.log('US State Capitals Loaded:', usStateCapitalsData.length);
        console.log('European Capitals Loaded:', europeanCapitalsData.length);

        // Re-enable buttons now that the data is ready
        loadCityScores(); // Load scores from localStorage
        difficultyButtons.forEach(btn => btn.disabled = false);
    }

    /**
     * Starts the game with a selected number of rounds.
     */
    function startGame(rounds, difficulty) {
        isEndlessMode = (rounds === 'endless'); // Set endless mode flag
        totalRounds = isEndlessMode ? Infinity : rounds; // Set totalRounds to Infinity for endless mode
        currentRound = 0;
        totalScore = 0;
        selectedDifficulty = difficulty;
        quitGameBtn.style.display = 'none'; // Hide quit button initially

        // Select the capital pool based on difficulty
        switch (selectedDifficulty) {
            case 'easy':
                currentCapitalPool = [...usStateCapitalsData];
                break;
            case 'medium':
                currentCapitalPool = [...europeanCapitalsData];
                break;
            case 'hard':
                currentCapitalPool = [...worldCapitalsData];
                break;
            default:
                currentCapitalPool = [...worldCapitalsData];
        }
        availableCapitals = [...currentCapitalPool]; // Create a fresh copy for the game rounds

        if (availableCapitals.length === 0) {
            alert("No capital data loaded for this difficulty. Please try again later.");
            // Optionally, reset UI to setup container
            setupContainer.style.display = 'block';
            mapContainer.style.display = 'none';
            uiContainer.style.display = 'none';
            return;
        }

        setupContainer.style.display = 'none';
        gameOverContainer.style.display = 'none';
        mapContainer.style.display = 'block';
        uiContainer.style.display = 'block';

        // Tell Leaflet to update its size now that the container is visible, and recenter
        map.invalidateSize(); // Ensure map tiles render correctly
        map.setView([20, 0], 2); // Reset map view for new game start

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
        
        // Get existing data or create a new entry
        const cityData = { score: 0, streak: (cityScores[cityId].streak || 0)};

        // Update score
        cityData.score = score;

        // Update streak based on performance
        if (score >= CORRECT_SCORE_THRESHOLD) {
            cityData.streak = Math.max(1, cityData.streak + 2); // Increment streak, ensuring it's at least 1 for a correct answer.
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
        if (guessMarker) map.removeLayer(guessMarker);
        if (answerMarker) map.removeLayer(answerMarker);
        if (answerLine) map.removeLayer(answerLine); 
        // map.setView([20, 0], 2); // Removed per user request to not reset view each round

        gameWeightedPlayedCapitals = [];

        // First, find the maximum positive streak across all scored cities.
        const maxStreak = Object.values(cityScores).reduce((max, city) => {
            return city.streak > max ? city.streak : max;
        }, 0);
        console.log("Current Max Streak:", maxStreak);

        // Separate the available pool into two groups
        availableCapitals.filter(c => !recentlyChosenCapitals.some(rc => getCityId(rc) === getCityId(c))).forEach(capital => {
            const cityId = getCityId(capital);

            const cityData = cityScores[cityId];
            const streak = cityData.streak || 0;
            
            let weight;

            if (streak < 0) {
                weight = 400; // Keep a very high fixed weight for incorrect answers.
            } else {
                // Weight is exponentially higher for streaks further from the max streak.
                weight = Math.max(1, Math.round(Math.pow(2.5, maxStreak - streak)));
            }
            for (let i = 0; i < weight; i++) {
                gameWeightedPlayedCapitals.push(capital);
            }
        });
        console.log('Never played capitals:', gameNeverPlayedCapitals);
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
        if (isEndlessMode) quitGameBtn.style.display = 'block'; // Show quit button in endless mode
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

        // Display results
        resultEl.innerHTML = `You were <b>${distance.toFixed(0)} km</b> away. Your score is <b>${score}/100</b>.`;
        totalScoreEl.textContent = totalScore; // Update total score display
        nextRoundBtn.style.display = 'block';

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
    difficultyButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            selectedDifficulty = e.target.getAttribute('data-difficulty');
            difficultyButtons.forEach(btn => btn.classList.remove('selected'));
            e.target.classList.add('selected');
            roundsSelection.style.display = 'block'; // Show round options
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

    startGameBtn.addEventListener('click', () => {
        if (selectedDifficulty && selectedRounds) {
            startGame(selectedRounds, selectedDifficulty);
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
        difficultyButtons.forEach(btn => btn.classList.remove('selected'));
        roundButtons.forEach(btn => btn.classList.remove('selected'));
        quitGameBtn.style.display = 'none'; // Ensure quit button is hidden
        startGameBtn.disabled = true; // Disable start button until new selection
        isEndlessMode = false; // Reset endless mode state
        selectedDifficulty = null;
        selectedRounds = null;
    });

    // --- Initial Data Load ---
    initializeGameData();
});