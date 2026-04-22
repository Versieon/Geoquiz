document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const setupContainer = document.getElementById('setup-container');
    const groupingButtons = document.querySelectorAll('.grouping-btn');
    const roundsSelection = document.getElementById('rounds-selection');
    const startGameBtn = document.getElementById('start-game-btn');
    const modeButtons = document.querySelectorAll('.mode-btn');
    const countrySelectionContainer = document.getElementById('country-selection-container');
    const countrySelect = document.getElementById('country-select');
    const cityCountInput = document.getElementById('city-count-input');
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
        zoom: 3,
        minZoom: 3, 
        maxZoom: 8, 
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
    let gameMode = 'capitals'; // 'capitals' or 'cities'

    let currentCapitalPool = []; // The pool of capitals for the current game
    let WeightedCapitals = []; // Weighted list of previously played capitals for the current game
    const RECENT_CAPITALS_LIMIT = 2; // How many recent capitals to avoid picking
    let recentlyChosenCapitals = []; // Stores the last N chosen capitals
    let cityScores = {}; // Stores best scores for each city: { "city-country": bestScore }
    let minstreak = 0;
    // --- Functions ---

    /**
     * @param {string} countryCode - The two-letter ISO code for the country (e.g., 'IE', 'US').
     * @param {number} N - The number of top cities to fetch.
     * @returns {Promise<Array>} A promise that resolves to an array of city objects.
     */
    async function fetchCities(countryName, countryCode, N) {
        const url = `https://public.opendatasoft.com/api/records/1.0/search/?dataset=geonames-all-cities-with-a-population-1000&rows=${N}&sort=population&refine.country_code=${countryCode}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`OpenDataSoft API error! status: ${response.status}`);
            }
            const data = await response.json();
            if (!data.records) {
                console.log(`No cities found for ${countryCode} on OpenDataSoft, or data structure is invalid.`);
                return [];
            }

            // Transform the OpenDataSoft data into our application's format.
            const cities = data.records.map(record => ({
                city: record.fields.name,
                country: countryName
            }));

            console.log(`Fetched top ${cities.length} cities for ${countryCode} from OpenDataSoft:`, cities);
            return cities;
        } catch (error) {
            console.error(`Could not fetch top cities for ${countryCode} from OpenDataSoft:`, error);
            return [];
        }
    }

    async function fetchCapitals(type, value) {
        const fields = 'name,capital,capitalInfo,cca2';
        const baseUrl = 'https://restcountries.com/v4/';
        let endpoint = '';

        if (type === 'all') {
            endpoint = 'all';
        } else if (type === 'region' || type === 'subregion') {
            endpoint = `${type}/${value}`;
        } else {
            console.error(`Invalid fetch type: ${type}`);
            return [];
        }

        const url = `${baseUrl}${endpoint}?fields=${fields}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            console.log(`Fetched raw capitals for ${type} '${value}':`, data);

            // Use reduce to handle countries with multiple capitals, creating a flat list.
            let transformedData = await data.reduce(async (accPromise, country) => {
                const acc = await accPromise;
                if (country.capital && country.capital.length > 0) {
                    for (let i = 0; i < country.capital.length; i++) {
                        const capitalName = country.capital[i];
                        const countryname = country.name.common;
                        const cca2 = country.cca2;

                        // Handle the primary capital using the provided lat/lon
                        if (i === 0 && country.capitalInfo?.latlng?.length === 2) {
                            acc.push({
                                city: capitalName,
                                country: countryname,
                                cca2: cca2,
                                lat: country.capitalInfo.latlng[0],
                                lon: country.capitalInfo.latlng[1],
                            });
                        } else if (i > 0) {
                            acc.push({ 
                                city: capitalName, 
                                country: countryname, 
                                cca2: cca2
                            });
                        }
                    }
                }
                return acc;
            }, Promise.resolve([]));

            // --- Data Patching ---
            // A list of cities with known data issues that need to be corrected via Nominatim.
            // If patching fails for a city, it will be removed from the game pool.
            const citiesToPatch = [
                { city: 'El Aaiún', country: 'Western Sahara' },
                { city: 'Mata-Utu', country: 'Wallis and Futuna' },
                { city: "St. George's", country: 'Grenada' }
            ];
            const finalData = [];
            for (const capital of transformedData) {
                // Check if the current capital matches both city and country of a patch target
                if (citiesToPatch.some(p => p.city === capital.city && p.country === capital.country)) {
                    console.log(`Applying data patch for ${capital.city}. Original coords:`, { lat: capital.lat, lon: capital.lon });
                    const newCapital = await getCityCoordinatesFull(capital);
                    if (newCapital) {
                        finalData.push(newCapital); // Add the successfully patched capital
                        console.log(`Successfully patched ${capital.city}.`);
                    }
                } else {
                    finalData.push(capital); // Add non-patched capitals directly
                }
            }
            return finalData;
        } catch (error) {
            console.error(`Could not fetch capitals for ${type} '${value}':`, error);
            return []; // Return empty array on error
        }
    }

    async function fetchUrl(url) {
        try {
            let response = await fetch(url);
            let data = await response.json();
            return data;
        } catch (error) {
            console.error("Error fetching data:", error);
            return null;
        }
    }

    async function getCityCoordinatesFull(capital) {
        const cityName = capital.city;
        const countryname = capital.country;
        // First attempt: Search with both city and country for specificity
        let url = `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(cityName)}&country=${encodeURIComponent(countryname)}&format=json`;
        let data = await fetchUrl(url);

        // Fallback: If the first search failed, try again with just the city name
        if (!data || data.length === 0) {
            console.log(`Specific search failed for "${cityName}, ${countryname}". Trying first fallback.`);
            url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)}+${encodeURIComponent(countryname)}&format=json`;
            data = await fetchUrl(url);
        }

        if (!data || data.length === 0) {
            console.log(`Specific search failed for "${cityName}, ${countryname}". Trying final fallback.`);
            url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)}&format=json`;
            data = await fetchUrl(url);
        }

        // If we have data from either search, process it
        if (data && data.length > 0) {
            console.log(`Found coordinates for "${cityName}" at url ${url}.`);
            const lat = parseFloat(parseFloat(data[0].lat).toFixed(2));
            const lon = parseFloat(parseFloat(data[0].lon).toFixed(2));
            capital.lat = lat;
            capital.lon = lon;
            return capital;
        }

        // If both searches failed
        console.log(`All searches failed for "${cityName}".`);
        return null;
    }


    /**
     * Fetches and transforms US state capital data from a public API.
     * @returns {Promise<Array>} A promise that resolves to an array of US state capital objects.
     */
    async function fetchUsStateCapitals() {
        try {
            const response = await fetch('https://raw.githubusercontent.com/jasperdebie/VisInfo/refs/heads/master/us-state-capitals.csv');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const csvText = await response.text();
            console.log('Fetched raw US state capitals CSV:', csvText);

            // Parse the CSV data. The format is: name,capital,lat,lon
            const lines = csvText.trim().split('\n');
            const transformedData = lines
                .slice(1) // Skip the header row
                .filter(line => line.split(',').length === 4) // Ensure line has all 4 columns
                .map(line => {
                    const [name, capital, lat, lon] = line.split(','); 
                    return {
                        city: capital.replace(/<br>/g, ''), // Strip out any <br> tags
                        country: name, // Using the state name for the 'country' field
                        lat: parseFloat(lat),
                        lon: parseFloat(lon)
                    };
                })
                .filter(c => !isNaN(c.lat) && !isNaN(c.lon)); // Filter out entries with invalid lat/lon
            console.log('Transformed US state capitals:', transformedData);
            return transformedData;
        } catch (error) {
            console.error('Could not fetch US state capitals:', error);
            return [];
        }
    }

    function getCityId(capital) {
        return `${capital.city}-${capital.country}`.toLowerCase();
    }

    function generateSimplifiedExponential(inputList) {
        const N = inputList.length;
        if (N === 0) return [];

        //Find the number of unique "tiers" and count entries in each
        const tierCounts = new Map();
        for (const entry of inputList) {
            tierCounts.set(entry.value, (tierCounts.get(entry.value) || 0) + 1);
        }

        const uniqueTiers = Array.from(tierCounts.keys()).sort((a, b) => a - b);
        const R = uniqueTiers.length;

        if (R === 1) {
            return inputList.flatMap(entry => Array(20).fill(entry.item));
        }

        //Fit function to that many tiers
        const targetLength = 20 * N;
        const highestTierCount = tierCounts.get(uniqueTiers[R - 1]);
        minstreak = tierCounts.get(uniqueTiers[0]);
        
        const base = Math.pow(targetLength / highestTierCount, 1 / (R - 1));

        const result = [];
        const debugArray = [];

        //Get totals for each tier, divide by entries, and populate
        for (const entry of inputList) {
            // Find which tier this item belongs to (0 is lowest value/highest tier)
            const tierIndex = uniqueTiers.indexOf(entry.value);
            const power = R - 1 - tierIndex; 
            
            // Total slots this ENTIRE tier gets
            const tierTotalSlots = highestTierCount * Math.pow(base, power);
            
            // Divide by the number of entries in this tier to get the final multiplier
            const entriesInTier = tierCounts.get(entry.value);
            const finalMultiplier = Math.max(1, Math.round(tierTotalSlots / entriesInTier));

            // Add the items to the final array
            for (let j = 0; j < finalMultiplier; j++) {
                result.push(entry.item);
            }
            const cityname = entry.item.city;
            const countryname = entry.item.country;
            const streak = entry.value;
        
            debugArray.push({streak, finalMultiplier, cityname, countryname});
        }

        debugArray.sort((a, b) => b.finalMultiplier - a.finalMultiplier);
        console.log("Debug array:", debugArray);

        return result;
    }

    async function getGrouping(grouping) {
        let fetchedCapitals = [];
        switch (grouping) {
            case 'usstates':
                fetchedCapitals = await fetchUsStateCapitals();
                break;
            case 'europe':
                fetchedCapitals = await fetchCapitals('region', 'europe', 5);
                break;
            case 'all':
                fetchedCapitals = await fetchCapitals('all');
                break;
            case 'africa':
                fetchedCapitals = await fetchCapitals('region', 'africa');
                break;
            case 'americas':
                fetchedCapitals = await fetchCapitals('region', 'americas');
                break;
            case 'northamerica':
                const northern = await fetchCapitals('subregion', 'north america');
                const central = await fetchCapitals('subregion', 'central america');
                fetchedCapitals = [...northern, ...central];
                break;
            case 'eastasia':
                const centralasia = await fetchCapitals('subregion', 'central asia');
                const eastasia = await fetchCapitals('subregion', 'eastern asia');
                const southeastasia = await fetchCapitals('subregion', 'south-eastern asia');
                fetchedCapitals = [...centralasia, ...eastasia, ...southeastasia];
                break;
            case 'westasia':
                const western = await fetchCapitals('subregion', 'western asia');
                const southern = await fetchCapitals('subregion', 'southern asia');
                fetchedCapitals = [...western, ...southern];
                break;
            case 'asia':
                fetchedCapitals = await fetchCapitals('region', 'asia');
                break;
            case 'caribbean':
                fetchedCapitals = await fetchCapitals('subregion', 'caribbean');
                break;
            case 'southamerica':
                fetchedCapitals = await fetchCapitals('subregion', 'south america');
                break;
            case 'oceania':
                fetchedCapitals = await fetchCapitals('region', 'oceania');
                break;
            default:
                console.error("Invalid grouping selected:", grouping);
                return [];
        }
        return fetchedCapitals;
    }

    /**
     * Starts the game with a selected number of rounds.
     */
    async function startGame(grouping, preFetchedCapitals = null) {
        startGameBtn.disabled = true;
        startGameBtn.textContent = 'Loading...';
        let fetchedCapitals = preFetchedCapitals || await getGrouping(grouping);

        if (fetchedCapitals.length === 0) {
            alert("Could not load capital data for this grouping. Please try again.");
            startGameBtn.disabled = false;
            startGameBtn.textContent = 'Start Game';
            return;
        }

        // 2. Set up game state
        isEndlessMode = true; // Always endless mode
        totalRounds = Infinity; // Set totalRounds to Infinity for endless mode
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
        map.setView([20, 0], 3); // Reset map view for new game start

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
            cityData.streak = Math.max(1, cityData.streak + 1); 
        } else {
            cityData.streak = Math.max(0, cityData.streak -2);
        }
        cityScores[cityId] = cityData;
        localStorage.setItem('capitalQuizScores', JSON.stringify(cityScores));
        console.log(`Updated data for ${cityId}:`, cityData);
    }

    /**
     * Calculates distance between two lat/lon points in km using Haversine formula.
     */
    function getDistance(lat1, lon1, lat2, lon2) {
        // Calculate the difference in longitude, and adjust for the shortest path around the globe
        let lonDiff = lon2 - lon1;
        if (lonDiff > 180) {
            lonDiff -= 360;
        } else if (lonDiff < -180) {
            lonDiff += 360;
        }
        const R = 6371; // Radius of the Earth in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = lonDiff * Math.PI / 180;
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
    async function startNewRound() {
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

        WeightedCapitals = [];

        const potentialPicks = availableCapitals.filter(c => !recentlyChosenCapitals.some(rc => getCityId(rc) === getCityId(c)));
        
        const picksWithWeights = potentialPicks.map(item => {
            const cityId = getCityId(item);
            const value = cityScores[cityId]?.streak || 0;                      
            return { item, value };
        });

        //WeightedCapitals = generateObjectDistribution(picksWithWeights);
        WeightedCapitals = generateSimplifiedExponential(picksWithWeights);

        console.log('Weighted played capitals:', WeightedCapitals);
      
        if (WeightedCapitals.length > 0) {
            const randomIndex = Math.floor(Math.random() * WeightedCapitals.length);
            currentCapital = WeightedCapitals[randomIndex]; // Just pick, don't splice yet
            console.log("Got new capital from weighted list:", currentCapital.city, ' ', currentCapital.country);
        } else {
            // Fallback: if both lists are exhausted, pick randomly from the original pool
            currentCapital = currentCapitalPool[Math.floor(Math.random() * currentCapitalPool.length)];
        }
        
        // If the chosen capital is missing coordinates, fetch them.
        if (!currentCapital.lat || !currentCapital.lon) {
            console.log(`Coordinates missing for ${currentCapital.city}. Fetching...`);
            const updatedCapital = await getCityCoordinatesFull(currentCapital);
            if (updatedCapital) {
                currentCapital = updatedCapital; // Use the updated capital for this round.
                // Find and update the capital in the main pool for future rounds.
                const indexToUpdate = availableCapitals.findIndex(c => getCityId(c) === getCityId(updatedCapital));
                if (indexToUpdate !== -1) {
                    availableCapitals[indexToUpdate] = updatedCapital;
                    console.log(`Updated ${currentCapital.city} in the available capitals pool.`);
                }
            } else {
                console.error(`Failed to fetch coordinates for ${currentCapital.city}. Skipping to next round.`);
                startNewRound(); // Try again with a different capital.
                return; // Stop execution of the current broken round.
            }
        }

        // Manage the recently chosen list
        // Add the new capital to the front
        recentlyChosenCapitals.unshift(currentCapital);
        // If the list is over the limit, remove the oldest item from the end
        if (recentlyChosenCapitals.length > RECENT_CAPITALS_LIMIT) {
            recentlyChosenCapitals.pop();
        }

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

        let displayGuessLon = guessLon;
        let displayAnswerLon = answerLon;

        // If the shortest path crosses the anti-meridian...
        if (Math.abs(guessLon - answerLon) > 180) {
            // ...denormalize the longitudes to be in the same "world copy"
            if (guessLon < 0) displayGuessLon += 360;
            if (answerLon < 0) displayAnswerLon += 360;
        }

        // Create markers, line, and bounds using the same (potentially denormalized) coordinates
        const guessPoint = [guessLat, displayGuessLon];
        const answerPoint = [answerLat, displayAnswerLon];

        guessMarker = L.marker(guessPoint, { opacity: 0.6 }).addTo(map);
        answerMarker = L.marker(answerPoint).addTo(map).bindPopup(`Actual Location`).openPopup();
        answerLine = L.polyline([guessPoint, answerPoint], { color: 'red' }).addTo(map);
        
        // Only zoom the map if the guess and answer aren't already visible.
        const requiredBounds = L.latLngBounds([guessPoint, answerPoint]);
        if (!map.getBounds().contains(requiredBounds)) {
            map.fitBounds(requiredBounds.pad(0.2));
        }
    }

    // --- Event Listeners ---
    modeButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            gameMode = e.target.getAttribute('data-mode');
            modeButtons.forEach(btn => btn.classList.remove('selected'));
            e.target.classList.add('selected');

            // Hide other UI sections when mode changes to force re-selection
            roundsSelection.style.display = 'none';
            countrySelectionContainer.style.display = 'none';
            groupingButtons.forEach(btn => btn.classList.remove('selected'));
        });
    });

    groupingButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
            selectedGrouping = e.target.getAttribute('data-grouping');
            groupingButtons.forEach(btn => btn.classList.remove('selected'));
            e.target.classList.add('selected');

            if (gameMode === 'capitals') {
                countrySelectionContainer.style.display = 'none';
                roundsSelection.style.display = 'block';
                startGameBtn.disabled = false;
            } else { // gameMode === 'cities'
                roundsSelection.style.display = 'none';
                countrySelect.innerHTML = '<option>Loading countries...</option>';
                countrySelectionContainer.style.display = 'block';

                // Fetch countries for the selected region
                console.log('Fetching countries for grouping:', selectedGrouping);
                const countries = await getGrouping(selectedGrouping)
                console.log('Fetched countries:', countries);

                countrySelect.innerHTML = ''; // Clear loading message
                if (countries.length > 0) {
                    // Sort countries alphabetically
                    countries.sort((a, b) => a.country.localeCompare(b.country));

                    countries.forEach(country => {
                        const option = document.createElement('option');
                        option.value =  country.cca2;
                        option.textContent = country.country;
                        countrySelect.appendChild(option);
                    });
                } else {
                    countrySelect.innerHTML = '<option>No countries found</option>';
                }
            }
        });
    });

    startGameBtn.addEventListener('click', async () => {
        if (selectedGrouping) {
            // Always start in endless mode
            await startGame(selectedGrouping);
        }
    });

    document.getElementById('start-cities-game-btn').addEventListener('click', async () => {
        const selectedCountryCode = countrySelect.value;
        const countryName = countrySelect.options[countrySelect.selectedIndex].text;
        const cityCount = parseInt(cityCountInput.value, 10);
        if (!selectedCountryCode || !cityCount) return;

        console.log(`Fetching top ${cityCount} cities for country: ${countryName} (${selectedCountryCode})`);
        const cities = await fetchCities(countryName, selectedCountryCode, cityCount);
        await startGame(selectedGrouping, cities);
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
        quitGameBtn.style.display = 'none'; // Ensure quit button is hidden
        startGameBtn.disabled = true; // Disable start button until new selection
        isEndlessMode = false; // Reset endless mode state
        selectedGrouping = null;
    });

    // --- Initial Setup ---
    loadCityScores(); // Load any existing user scores from localStorage

});