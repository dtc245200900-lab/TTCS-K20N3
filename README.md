# HỆ THỐNG QUẢN LÝ KHÁCH SẠN

## 1. Giới thiệu dự án

**Hệ thống quản lý khách sạn** là một hệ thống phần mềm hỗ trợ quản lý và vận hành các hoạt động của khách sạn trên một nền tảng tập trung.

Hệ thống giúp quản lý thông tin phòng, khách hàng, đặt phòng, thuê và trả phòng, thanh toán, hóa đơn, buồng phòng, bảo trì, tài khoản nhân viên và các báo cáo kinh doanh.

Dự án được xây dựng dựa trên **Product Backlog gồm 40 User Story**, được phân chia thành các nhóm chức năng chính nhằm đáp ứng nhu cầu của quản trị viên, quản lý, nhân viên lễ tân, nhân viên buồng phòng và người dùng hệ thống.

## 2. Mục tiêu dự án

* Quản lý tập trung thông tin phòng và trạng thái phòng.
* Hỗ trợ nhân viên lễ tân thực hiện quy trình đặt phòng, thuê phòng và trả phòng.
* Quản lý thông tin và lịch sử của khách hàng.
* Quản lý đặt phòng và chuyển đặt phòng thành phiên thuê.
* Tự động tính tiền phòng dựa trên thời lượng thuê và bảng giá.
* Quản lý tiền đặt cọc, thanh toán và hóa đơn.
* Hỗ trợ hoàn tiền và hủy giao dịch có kiểm soát.
* Hỗ trợ nhân viên buồng phòng quản lý tình trạng phòng cần dọn.
* Quản lý tình trạng bảo trì của phòng.
* Quản lý tài khoản và phân quyền nhân viên.
* Cung cấp báo cáo doanh thu và công suất phòng.
* Ghi nhận nhật ký các thao tác quan trọng để phục vụ kiểm tra và đối soát.

## 3. Đối tượng sử dụng

### Quản trị viên

Quản trị viên chịu trách nhiệm quản lý tài khoản nhân viên và quyền truy cập hệ thống.

Các chức năng chính:

* Tạo tài khoản nhân viên.
* Khóa tài khoản nhân viên.
* Gán vai trò cho nhân viên.
* Kiểm soát quyền truy cập hệ thống.

### Quản lý

Quản lý chịu trách nhiệm quản lý hoạt động và cấu hình của khách sạn.

Các chức năng chính:

* Quản lý phòng.
* Cấu hình loại phòng.
* Cấu hình bảng giá và đơn vị tính.
* Quản lý bảo trì phòng.
* Theo dõi doanh thu.
* Xem báo cáo công suất phòng.
* Hoàn tiền hoặc hủy giao dịch.
* Xem lịch sử thuê.
* Tra cứu nhật ký thay đổi.

### Nhân viên lễ tân

Nhân viên lễ tân thực hiện các nghiệp vụ phục vụ khách hàng và vận hành phòng.

Các chức năng chính:

* Xem trạng thái phòng.
* Tìm kiếm và lọc phòng.
* Tạo phiên thuê.
* Ghi nhận thông tin khách hàng.
* Tạo, sửa và hủy đặt phòng.
* Chuyển đặt phòng thành phiên thuê.
* Gia hạn thời gian thuê.
* Thực hiện trả phòng.
* Ghi nhận đặt cọc và thanh toán.
* Xem và in hóa đơn.

### Nhân viên buồng phòng

Nhân viên buồng phòng chịu trách nhiệm cập nhật tình trạng dọn phòng.

Các chức năng chính:

* Xem danh sách phòng cần dọn.
* Xác nhận phòng đã được dọn.
* Cập nhật trạng thái phòng để lễ tân có thể tiếp tục phục vụ khách.

### Người dùng

Người dùng có thể thực hiện các chức năng liên quan đến tài khoản cá nhân.

* Đăng nhập.
* Đăng xuất.
* Đổi mật khẩu.
* Cập nhật hồ sơ cá nhân.

## 4. Các chức năng chính

### 4.1. Tài khoản và bảo mật

* Đăng nhập và xác thực người dùng.
* Đăng xuất an toàn.
* Đổi mật khẩu.
* Cập nhật hồ sơ cá nhân.
* Tạo và khóa tài khoản nhân viên.
* Phân quyền theo vai trò.
* Tra cứu nhật ký thay đổi.

### 4.2. Quản lý phòng

* Tạo phòng mới.
* Sửa thông tin phòng.
* Xóa phòng đủ điều kiện.
* Quản lý mã phòng.
* Quản lý loại phòng.
* Quản lý giá phòng.
* Theo dõi trạng thái phòng.

Các trạng thái phòng bao gồm:

* Trống.
* Đang thuê.
* Đã đặt.
* Chờ dọn.
* Bảo trì.

### 4.3. Vận hành phòng

Nhân viên lễ tân có thể:

* Xem danh sách phòng.
* Tìm phòng theo mã hoặc loại phòng.
* Lọc phòng theo trạng thái.
* Xem số lượng phòng theo từng trạng thái.
* Phân trang và sắp xếp danh sách.

### 4.4. Quản lý khách hàng

* Ghi nhận thông tin khách khi lập phiên thuê.
* Tìm kiếm khách hàng.
* Xem hồ sơ khách hàng.
* Hạn chế nhập trùng thông tin khách.
* Tra cứu thông tin khách phục vụ các giao dịch.

### 4.5. Thuê và trả phòng

* Tạo phiên thuê cho phòng trống.
* Ghi nhận thời gian bắt đầu thuê.
* Ghi nhận thời gian dự kiến trả.
* Gia hạn thời gian thuê.
* Trả phòng.
* Ghi nhận thời gian trả thực tế.
* Xem lịch sử thuê của phòng.

### 4.6. Đặt phòng

* Tạo đặt phòng trước.
* Sửa đặt phòng.
* Hủy đặt phòng.
* Chuyển đặt phòng thành phiên thuê khi khách đến.

### 4.7. Thanh toán và hóa đơn

* Tính tiền phòng theo thời lượng thuê.
* Áp dụng giá theo chính sách của khách sạn.
* Ghi nhận tiền đặt cọc.
* Ghi nhận thanh toán.
* Theo dõi số tiền còn phải thu.
* Xem và in hóa đơn.
* Hoàn tiền hoặc hủy giao dịch có lý do.

### 4.8. Buồng phòng

* Xem danh sách phòng cần dọn.
* Xác nhận phòng đã dọn.
* Cập nhật trạng thái phòng sau khi dọn.

### 4.9. Bảo trì

* Đánh dấu phòng cần bảo trì.
* Ngăn không cho phòng bảo trì được nhận thuê.
* Đưa phòng trở lại hoạt động sau khi sửa chữa.

### 4.10. Cấu hình hệ thống

* Cấu hình loại phòng.
* Cấu hình bảng giá.
* Cấu hình đơn vị tính.
* Cấu hình thông tin cơ sở.
* Cấu hình múi giờ của khách sạn.

### 4.11. Báo cáo và thống kê

Hệ thống hỗ trợ:

* Báo cáo doanh thu theo tháng.
* Lựa chọn năm báo cáo.
* Lọc doanh thu theo khoảng ngày.
* Lọc doanh thu theo phương thức thanh toán.
* Xuất báo cáo doanh thu dạng PDF.
* Báo cáo công suất phòng theo ngày/tháng.

## 5. Quy trình nghiệp vụ chính

Quy trình hoạt động cơ bản của hệ thống:

```text
Khách hàng
    ↓
Đặt phòng
    ↓
Khách đến nhận phòng
    ↓
Tạo phiên thuê
    ↓
Theo dõi thời gian thuê
    ↓
Gia hạn (nếu có)
    ↓
Trả phòng
    ↓
Tính tiền
    ↓
Thanh toán
    ↓
Xuất hóa đơn
    ↓
Phòng chờ dọn
    ↓
Nhân viên buồng phòng dọn phòng
    ↓
Phòng trở về trạng thái Trống
```

Ngoài ra, phòng có thể được chuyển sang trạng thái **Bảo trì** khi phát hiện cần sửa chữa và chỉ được đưa trở lại hoạt động sau khi hoàn tất bảo trì.

## 6. Báo cáo và quản lý dữ liệu

Hệ thống cung cấp các báo cáo phục vụ quản lý khách sạn:

* Doanh thu theo tháng trong năm.
* So sánh dữ liệu giữa các năm.
* Doanh thu theo khoảng thời gian.
* Doanh thu theo phương thức thanh toán.
* Công suất sử dụng phòng theo ngày/tháng.
* Lịch sử thuê phòng.
* Nhật ký các thao tác quan trọng.

Các báo cáo được xây dựng dựa trên dữ liệu giao dịch thực tế và tuân thủ quyền truy cập của từng vai trò.

## 7. Phân quyền hệ thống

| Vai trò       | Chức năng chính                                          |
| ------------- | -------------------------------------------------------- |
| Quản trị viên | Quản lý tài khoản, khóa tài khoản, phân quyền            |
| Quản lý       | Quản lý phòng, giá, bảo trì, báo cáo, giao dịch          |
| Lễ tân        | Đặt phòng, thuê phòng, trả phòng, khách hàng, thanh toán |
| Buồng phòng   | Xem và cập nhật tình trạng dọn phòng                     |
| Người dùng    | Đăng nhập, đăng xuất, đổi mật khẩu, cập nhật hồ sơ       |

## 8. Product Backlog

Dự án hiện có **40 User Story**, được phân chia thành các Epic:

* Tài khoản & bảo mật
* Danh mục phòng
* Vận hành phòng
* Thuê & trả phòng
* Quản lý khách
* Thanh toán & hóa đơn
* Đặt phòng
* Buồng phòng
* Bảo trì
* Cấu hình
* Báo cáo & xuất dữ liệu

Các User Story trong backlog được xác định với:

* ID.
* Feature/User Story.
* Description.
* Acceptance Criteria.
* Priority.
* Status.
* Epic.
* Story Points.
* Dependencies.

## 9. Trạng thái dự án

Dự án đang được phát triển theo Product Backlog. Các chức năng sẽ được triển khai, kiểm thử và hoàn thiện dựa trên mức độ ưu tiên và các tiêu chí chấp nhận được xác định trong backlog.

## 10. Công nghệ sử dụng

> Phần này cập nhật theo công nghệ thực tế mà nhóm sử dụng trong quá trình triển khai.

Dự kiến có thể bao gồm:

* Frontend: HTML, CSS, JavaScript / React
* Backend: Node.js / Express
* Database: MySQL / SQL Server / SQLite
* Git và GitHub: Quản lý mã nguồn
* Visual Studio Code: Môi trường phát triển

## 11. Thành viên dự án

| STT | Họ và tên    | Vai trò |
| --- | ------------ | ------- |
| 1   | Thành viên 1 | ...     |
| 2   | Thành viên 2 | ...     |
| 3   | Thành viên 3 | ...     |
| 4   | Thành viên 4 | ...     |

---

**Repository:** Hệ thống quản lý khách sạn
**Loại dự án:** Phần mềm quản lý khách sạn
**Nguồn yêu cầu:** Product Backlog của dự án
