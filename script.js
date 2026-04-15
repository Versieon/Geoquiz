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
    let selectedDifficulty = null;

    // --- Data Storage for different difficulties ---
    let worldCapitalsData = [];
    let usStateCapitalsData = [];
    let europeanCapitalsData = [];
    let currentCapitalPool = []; // The pool of capitals for the current game

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
                    const [name, capital, lat, lon] = line.split(',');
                    return {
                        city: capital,
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
        difficultyButtons.forEach(btn => btn.disabled = false);
    }

    /**
     * Starts the game with a selected number of rounds.
     */
    function startGame(rounds, difficulty) {
        totalRounds = rounds;
        currentRound = 0;
        totalScore = 0;
        selectedDifficulty = difficulty;

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
        map.setView([20, 0], 2); // Reset map view for new game

        startNewRound();
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
        totalScoreEl.textContent = totalScore;

        // 1. Reset UI and map layers
        resultEl.innerHTML = '';
        nextRoundBtn.style.display = 'none';
        if (guessMarker) map.removeLayer(guessMarker);
        if (answerMarker) map.removeLayer(answerMarker);
        if (answerLine) map.removeLayer(answerLine);

        // Reset map view if needed
        //map.setView([20, 0], 2); // Ensure map is centered and zoomed out for each new round

        // 2. Pick a new random capital from the available list to avoid repeats
        if (availableCapitals.length === 0) {
            // If we run out of unique capitals, reset the list from the current difficulty pool
            availableCapitals = [...currentCapitalPool];
        }
        const capitalIndex = Math.floor(Math.random() * availableCapitals.length);
        currentCapital = availableCapitals.splice(capitalIndex, 1)[0]; // Pick and remove from list

        questionEl.textContent = `Where is ${currentCapital.city}, ${currentCapital.country}?`;

        // 3. Enable map clicking
        mapClickHandler = map.on('click', handleMapClick);
    }

    /**
     * Ends the game and displays the final score.
     */
    function endGame() {
        const maxPossibleScore = totalRounds * 100;
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

        // Display results
        resultEl.innerHTML = `You were <b>${distance.toFixed(0)} km</b> away. Your score is <b>${score}/100</b>.`;
        totalScoreEl.textContent = totalScore; // Update total score display
        nextRoundBtn.style.display = 'block';

        // Change button text for the last round
        if (currentRound >= totalRounds) {
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
            selectedRounds = parseInt(e.target.getAttribute('data-rounds'), 10);
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
        if (currentRound < totalRounds) {
            startNewRound();
        } else {
            endGame();
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
        selectedDifficulty = null;
        selectedRounds = null;
    });

    // --- Initial Data Load ---
    initializeGameData();
});