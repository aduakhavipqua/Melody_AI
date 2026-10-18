import pandas as pd
import numpy as np
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.ensemble import RandomForestClassifier
import joblib
from pathlib import Path

print("Đang tải dữ liệu từ features_3_sec.csv...")
df = pd.read_csv(r'C:\abcxyz123\btl\CD\design\data\features_3_sec.csv')

# Tạo track_id từ filename để chia tập train/test không bị rò rỉ dữ liệu (Data Leakage)
df['track_id'] = df['filename'].apply(lambda x: '.'.join(x.split('.')[:2]))

X = df.drop(columns=['filename', 'length', 'label', 'track_id'])
y = df['label']
groups = df['track_id']

# Mã hóa nhãn thể loại nhạc
le = LabelEncoder()
y_encoded = le.fit_transform(y)

# Chuẩn hóa đặc trưng
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# Chia tập Train/Test theo bài hát (Group Split)
gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
train_idx, test_idx = next(gss.split(X_scaled, y_encoded, groups))

X_train, X_test = X_scaled[train_idx], X_scaled[test_idx]
y_train, y_test = y_encoded[train_idx], y_encoded[test_idx]

print(f"Đang huấn luyện mô hình trên {len(X_train)} mẫu...")
clf = RandomForestClassifier(n_estimators=200, random_state=42)
clf.fit(X_train, y_train)

# Đánh giá nhanh
acc = clf.score(X_test, y_test)
print(f"Độ chính xác trên tập Test: {acc * 100:.2f}%")

# Lưu mô hình, scaler và encoder vào thư mục model/
Path("model").mkdir(exist_ok=True)
joblib.dump(clf, 'model/music_classifier.pkl')
joblib.dump(scaler, 'model/scaler.pkl')
joblib.dump(le, 'model/label_encoder.pkl')

# Tạo file song_index.npz mẫu chứa danh sách bài hát để hệ thống truy vấn
titles = [
    "Mưa tháng sáu", "Có chắc yêu là đây", "Bước qua mùa cô đơn",
    "Nơi này có anh", "Lạ lùng", "Chạy ngay đi", "Hồng nhan",
    "Lạc trôi", "Đã lỡ yêu em nhiều", "Em của ngày hôm qua"
]
artists = [
    "Văn Mai Hương", "Sơn Tùng M-TP", "Vũ", "Sơn Tùng M-TP",
    "Vũ", "Sơn Tùng M-TP", "Jack", "Sơn Tùng M-TP", "JustaTee", "Sơn Tùng M-TP"
]
dummy_emb = np.random.randn(len(titles), 64)

np.savez('model/song_index.npz',
         titles=np.array(titles),
         artists=np.array(artists),
         audio=dummy_emb,
         melody=dummy_emb,
         lyrics=dummy_emb)

print("Huấn luyện và lưu trữ hoàn tất trong thư mục model/!")