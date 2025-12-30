import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.cluster import KMeans
import os

# Création dossier
if not os.path.exists('data'):
    os.makedirs('data')

# 1. Chargement
try:
    df = pd.read_csv('data/spotify.csv')
except FileNotFoundError:
    df = pd.read_csv('spotify.csv')

print(f"Chargement: {len(df)} musiques.")

# 2. Nettoyage
features = ['danceability', 'energy', 'loudness', 'speechiness', 'acousticness', 
            'instrumentalness', 'liveness', 'valence', 'tempo']

# On supprime les NaNs
df_clean = df.dropna(subset=features + ['track_name', 'track_album_release_date', 'playlist_genre']).copy()

# Extraction Année
def extract_year(date_str):
    try:
        return int(str(date_str).split('-')[0])
    except:
        return np.nan

df_clean['year'] = df_clean['track_album_release_date'].apply(extract_year)
df_clean = df_clean.dropna(subset=['year'])
df_clean['year'] = df_clean['year'].astype(int)

# 3. Normalisation
x = df_clean[features].values
scaler = StandardScaler()
x_scaled = scaler.fit_transform(x)

# 4. PCA
pca = PCA(n_components=2)
principalComponents = pca.fit_transform(x_scaled)
df_clean['pca1'] = principalComponents[:, 0]
df_clean['pca2'] = principalComponents[:, 1]

# 5. K-MEANS INTELLIGENT
print("Calcul des clusters...")
n_clusters = 6
kmeans = KMeans(n_clusters=n_clusters, random_state=42)
df_clean['cluster_id'] = kmeans.fit_predict(x_scaled)

# --- ETAPE CLÉ : NOMMER LES CLUSTERS (SÉMANTIQUE) ---
# On calcule la moyenne des features pour chaque cluster pour comprendre ce qu'il représente
print("Analyse sémantique des clusters...")
cluster_names = {}
for i in range(n_clusters):
    cluster_data = df_clean[df_clean['cluster_id'] == i]
    
    avg_energy = cluster_data['energy'].mean()
    avg_acoustic = cluster_data['acousticness'].mean()
    avg_dance = cluster_data['danceability'].mean()
    avg_speech = cluster_data['speechiness'].mean()
    avg_instru = cluster_data['instrumentalness'].mean()
    
    # Logique simple pour donner un nom (Labels heuristiques)
    name = f"Cluster {i}" # Fallback
    if avg_instru > 0.5:
        name = "Instrumental / Ambient"
    elif avg_speech > 0.2:
        name = "Speech / Rap"
    elif avg_acoustic > 0.6:
        name = "Acoustic / Calm"
    elif avg_energy > 0.7 and avg_dance > 0.6:
        name = "High Energy / Dance"
    elif avg_energy > 0.7:
        name = "Intense / Rock"
    elif avg_dance > 0.7:
        name = "Groovy / Pop"
    else:
        name = "Mixed / Mid-Tempo"
        
    cluster_names[i] = name

# Appliquer les noms
df_clean['cluster_label'] = df_clean['cluster_id'].map(cluster_names)

# 6. Export
output_cols = ['track_id', 'track_name', 'track_artist', 'playlist_genre', 
               'year', 'pca1', 'pca2', 'cluster_label'] + features

output_path = 'data/processed_data.csv'
df_clean[output_cols].to_csv(output_path, index=False)

print("Mapping des clusters généré :")
print(cluster_names)
print(f"Fichier sauvegardé : {output_path}")