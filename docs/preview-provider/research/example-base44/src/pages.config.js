import CreateOrder from './pages/CreateOrder';
import OrderDetails from './pages/OrderDetails';
import Orders from './pages/Orders';
import Templates from './pages/Templates';
import ArchiveMessageSettings from './pages/ArchiveMessageSettings';
import AlbumSellingTextSettings from './pages/AlbumSellingTextSettings';
import __Layout from './Layout.jsx';


export const PAGES = {
    "CreateOrder": CreateOrder,
    "OrderDetails": OrderDetails,
    "Orders": Orders,
    "Templates": Templates,
    "ArchiveMessageSettings": ArchiveMessageSettings,
    "AlbumSellingTextSettings": AlbumSellingTextSettings,
}

export const pagesConfig = {
    mainPage: "Orders",
    Pages: PAGES,
    Layout: __Layout,
};